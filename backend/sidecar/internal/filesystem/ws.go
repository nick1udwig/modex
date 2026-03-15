package filesystem

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type request struct {
	DirectoriesOnly bool   `json:"directoriesOnly"`
	ID              string `json:"id"`
	MaxResults      int    `json:"maxResults"`
	Path            string `json:"path"`
	Query           string `json:"query"`
	ShowHidden      bool   `json:"showHidden"`
	Type            string `json:"type"`
}

type response struct {
	Entries []Entry    `json:"entries,omitempty"`
	Error   *errorBody `json:"error,omitempty"`
	Entry   *Entry     `json:"entry,omitempty"`
	ID      string     `json:"id,omitempty"`
	Parent  string     `json:"parent,omitempty"`
	Path    string     `json:"path,omitempty"`
	Results []Entry    `json:"results,omitempty"`
	Roots   []Root     `json:"roots,omitempty"`
	Type    string     `json:"type"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

var acceptOptions = &websocket.AcceptOptions{
	// Origin policy is enforced by the HTTP middleware in internal/server.
	InsecureSkipVerify: true,
}

func Handler(service *Service, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, acceptOptions)
		if err != nil {
			logger.Warn("filesystem websocket accept failed", "error", err)
			return
		}
		defer conn.Close(websocket.StatusNormalClosure, "")

		logger.Info(
			"filesystem websocket connected",
			"remote_addr",
			r.RemoteAddr,
			"origin",
			r.Header.Get("Origin"),
		)

		ctx := r.Context()
		for {
			var req request
			if err := wsjson.Read(ctx, conn, &req); err != nil {
				if status := websocket.CloseStatus(err); status != websocket.StatusNormalClosure {
					logger.Info("filesystem websocket closed", "remote_addr", r.RemoteAddr, "status", status)
				}
				return
			}

			logger.Info(
				"filesystem request",
				"id",
				req.ID,
				"type",
				req.Type,
				"path",
				req.Path,
				"query",
				req.Query,
			)

			resp := handleRequest(ctx, service, req)
			if resp.Error != nil {
				logger.Warn(
					"filesystem request failed",
					"id",
					req.ID,
					"type",
					req.Type,
					"path",
					req.Path,
					"query",
					req.Query,
					"code",
					resp.Error.Code,
					"error",
					resp.Error.Message,
				)
			}

			if err := wsjson.Write(ctx, conn, resp); err != nil {
				logger.Warn("filesystem websocket write failed", "error", err)
				return
			}
		}
	}
}

func handleRequest(_ context.Context, service *Service, req request) response {
	switch req.Type {
	case "fs.roots":
		return response{
			ID:    req.ID,
			Roots: service.Roots(),
			Type:  "fs.roots.result",
		}

	case "fs.list":
		result, err := service.List(req.Path, req.ShowHidden, req.DirectoriesOnly)
		if err != nil {
			return errorResponse(req.ID, err)
		}
		return response{
			Entries: result.Entries,
			ID:      req.ID,
			Parent:  result.Parent,
			Path:    result.Path,
			Roots:   result.Roots,
			Type:    "fs.list.result",
		}

	case "fs.stat":
		entry, err := service.Stat(req.Path)
		if err != nil {
			return errorResponse(req.ID, err)
		}
		return response{
			Entry: &entry,
			ID:    req.ID,
			Type:  "fs.stat.result",
		}

	case "fs.search":
		results, err := service.Search(req.Path, req.Query, req.ShowHidden, req.DirectoriesOnly, req.MaxResults)
		if err != nil {
			return errorResponse(req.ID, err)
		}
		return response{
			ID:      req.ID,
			Path:    req.Path,
			Results: results,
			Type:    "fs.search.result",
		}

	default:
		return response{
			Error: &errorBody{
				Code:    "bad_request",
				Message: fmt.Sprintf("unsupported request type %q", req.Type),
			},
			ID:   req.ID,
			Type: "fs.error",
		}
	}
}

func errorResponse(id string, err error) response {
	code := "internal_error"
	switch {
	case errors.Is(err, ErrForbidden):
		code = "forbidden"
	case errors.Is(err, os.ErrNotExist):
		code = "not_found"
	}

	return response{
		Error: &errorBody{
			Code:    code,
			Message: err.Error(),
		},
		ID:   id,
		Type: "fs.error",
	}
}
