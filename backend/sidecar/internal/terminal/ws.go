package terminal

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"sync"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type request struct {
	Cwd    string `json:"cwd"`
	ID     string `json:"id"`
	Target string `json:"target"`
	Type   string `json:"type"`
}

type response struct {
	Error    *errorBody       `json:"error,omitempty"`
	ID       string           `json:"id,omitempty"`
	Session  *SessionSummary  `json:"session,omitempty"`
	Sessions []SessionSummary `json:"sessions,omitempty"`
	Type     string           `json:"type"`
}

type attachEvent struct {
	Message string          `json:"message,omitempty"`
	Session *SessionSummary `json:"session,omitempty"`
	Type    string          `json:"type"`
}

type attachControl struct {
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
	Type string `json:"type"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

var acceptOptions = &websocket.AcceptOptions{
	InsecureSkipVerify: true,
}

func ControlHandler(service *Service, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, acceptOptions)
		if err != nil {
			logger.Warn("terminal websocket accept failed", "error", err)
			return
		}
		defer conn.Close(websocket.StatusNormalClosure, "")

		ctx := r.Context()
		for {
			var req request
			if err := wsjson.Read(ctx, conn, &req); err != nil {
				if status := websocket.CloseStatus(err); status != websocket.StatusNormalClosure {
					logger.Info("terminal websocket closed", "remote_addr", r.RemoteAddr, "status", status)
				}
				return
			}

			resp := handleRequest(ctx, service, req)
			if err := wsjson.Write(ctx, conn, resp); err != nil {
				logger.Warn("terminal websocket write failed", "error", err)
				return
			}
		}
	}
}

func AttachHandler(service *Service, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, acceptOptions)
		if err != nil {
			logger.Warn("terminal attach accept failed", "error", err)
			return
		}
		defer conn.Close(websocket.StatusNormalClosure, "")

		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()

		target := r.URL.Query().Get("target")
		if target == "" {
			_ = wsjson.Write(ctx, conn, attachEvent{Message: "target is required", Type: "terminal.error"})
			return
		}

		rows := parseDimension(r.URL.Query().Get("rows"), 24)
		cols := parseDimension(r.URL.Query().Get("cols"), 80)
		session, err := service.InspectSession(ctx, target)
		if err != nil {
			_ = wsjson.Write(ctx, conn, attachEvent{Message: err.Error(), Type: "terminal.error"})
			return
		}

		if err := wsjson.Write(ctx, conn, attachEvent{Session: &session, Type: "terminal.session"}); err != nil {
			return
		}

		if session.Status != "live" && session.Status != "starting" {
			logData, readErr := service.ReadLog(session)
			if readErr != nil {
				_ = wsjson.Write(ctx, conn, attachEvent{Message: readErr.Error(), Type: "terminal.error"})
				return
			}
			if len(logData) > 0 {
				_ = conn.Write(ctx, websocket.MessageBinary, logData)
			}
			return
		}

		socket, attachedSession, err := service.AttachSession(ctx, target, rows, cols)
		if err != nil {
			_ = wsjson.Write(ctx, conn, attachEvent{Message: err.Error(), Type: "terminal.error"})
			return
		}
		defer socket.Close()

		if attachedSession.Status != session.Status {
			if err := wsjson.Write(ctx, conn, attachEvent{Session: &attachedSession, Type: "terminal.session"}); err != nil {
				return
			}
			session = attachedSession
		}

		var writeMu sync.Mutex
		writeBinary := func(payload []byte) error {
			writeMu.Lock()
			defer writeMu.Unlock()
			return conn.Write(ctx, websocket.MessageBinary, payload)
		}
		writeJSON := func(payload attachEvent) error {
			writeMu.Lock()
			defer writeMu.Unlock()
			return wsjson.Write(ctx, conn, payload)
		}

		outputDone := make(chan struct{})
		go func() {
			defer close(outputDone)
			buf := make([]byte, 4096)
			for {
				n, readErr := socket.Read(buf)
				if n > 0 {
					if err := writeBinary(buf[:n]); err != nil {
						return
					}
				}
				if readErr != nil {
					if errors.Is(readErr, io.EOF) {
						latest, inspectErr := service.InspectSession(ctx, target)
						if inspectErr == nil {
							_ = writeJSON(attachEvent{Session: &latest, Type: "terminal.session"})
						}
					}
					cancel()
					return
				}
			}
		}()

		for {
			msgType, payload, readErr := conn.Read(ctx)
			if readErr != nil {
				break
			}

			switch msgType {
			case websocket.MessageBinary:
				if _, err := socket.Write(payload); err != nil {
					_ = writeJSON(attachEvent{Message: err.Error(), Type: "terminal.error"})
					cancel()
					break
				}
			case websocket.MessageText:
				var control attachControl
				if err := json.Unmarshal(payload, &control); err != nil {
					continue
				}
				if control.Type == "resize" {
					if err := service.ResizeSession(ctx, session.SocketPath, control.Rows, control.Cols); err != nil {
						logger.Warn("terminal resize failed", "error", err, "target", target)
					}
				}
			}
		}

		cancel()
		<-outputDone
	}
}

func handleRequest(ctx context.Context, service *Service, req request) response {
	switch req.Type {
	case "terminal.sessions.list":
		sessions, err := service.ListSessions(ctx)
		if err != nil {
			return errorResponse(req.ID, err)
		}
		return response{
			ID:       req.ID,
			Sessions: sessions,
			Type:     "terminal.sessions.result",
		}

	case "terminal.session.create":
		session, err := service.CreateSession(ctx, req.Cwd)
		if err != nil {
			return errorResponse(req.ID, err)
		}
		return response{
			ID:      req.ID,
			Session: &session,
			Type:    "terminal.session.result",
		}

	case "terminal.session.inspect":
		session, err := service.InspectSession(ctx, req.Target)
		if err != nil {
			return errorResponse(req.ID, err)
		}
		return response{
			ID:      req.ID,
			Session: &session,
			Type:    "terminal.session.result",
		}

	default:
		return errorResponse(req.ID, errors.New("unsupported terminal request"))
	}
}

func errorResponse(id string, err error) response {
	return response{
		Error: &errorBody{
			Code:    "terminal_error",
			Message: err.Error(),
		},
		ID:   id,
		Type: "terminal.error",
	}
}
