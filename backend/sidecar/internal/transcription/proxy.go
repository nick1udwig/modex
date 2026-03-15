package transcription

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"

	"modex/backend/sidecar/internal/config"
)

const openAIBetaHeader = "realtime=v1"

var acceptOptions = &websocket.AcceptOptions{
	// Origin policy is enforced by the HTTP middleware in internal/server.
	InsecureSkipVerify: true,
}

type Proxy struct {
	apiKey         string
	defaultSession []byte
	logger         *slog.Logger
	upstreamURL    string
}

func NewProxy(cfg config.TranscriptionConfig, logger *slog.Logger) (*Proxy, error) {
	defaultSession, err := defaultSessionUpdate(cfg)
	if err != nil {
		return nil, err
	}

	return &Proxy{
		apiKey:         cfg.APIKey,
		defaultSession: defaultSession,
		logger:         logger,
		upstreamURL:    cfg.UpstreamURL,
	}, nil
}

func (p *Proxy) Handler(w http.ResponseWriter, r *http.Request) {
	clientConn, err := websocket.Accept(w, r, acceptOptions)
	if err != nil {
		p.logger.Warn("transcription websocket accept failed", "error", err)
		return
	}
	defer clientConn.Close(websocket.StatusNormalClosure, "")

	p.logger.Info(
		"transcription websocket connected",
		"remote_addr",
		r.RemoteAddr,
		"origin",
		r.Header.Get("Origin"),
	)

	if p.apiKey == "" {
		p.logger.Warn("transcription connection rejected because OPENAI_API_KEY is missing")
		_ = clientConn.Close(websocket.StatusPolicyViolation, "OPENAI_API_KEY is not configured")
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	upstreamConn, _, err := websocket.Dial(ctx, p.upstreamURL, &websocket.DialOptions{
		HTTPHeader: http.Header{
			"Authorization": []string{"Bearer " + p.apiKey},
			"OpenAI-Beta":   []string{openAIBetaHeader},
		},
	})
	if err != nil {
		p.logger.Warn("transcription upstream dial failed", "error", err, "upstream_url", p.upstreamURL)
		_ = clientConn.Close(websocket.StatusTryAgainLater, "failed to connect to transcription upstream")
		return
	}
	defer upstreamConn.Close(websocket.StatusNormalClosure, "")

	p.logger.Info("transcription upstream connected", "upstream_url", p.upstreamURL)

	if len(p.defaultSession) > 0 {
		writeCtx, writeCancel := context.WithTimeout(ctx, 5*time.Second)
		if err := upstreamConn.Write(writeCtx, websocket.MessageText, p.defaultSession); err != nil {
			writeCancel()
			p.logger.Warn("transcription session initialization failed", "error", err)
			_ = clientConn.Close(websocket.StatusTryAgainLater, "failed to configure transcription session")
			return
		}
		writeCancel()

		p.logger.Info("transcription session initialized")
	}

	errCh := make(chan error, 2)
	var closeOnce sync.Once
	closeBoth := func(status websocket.StatusCode, reason string) {
		closeOnce.Do(func() {
			cancel()
			_ = clientConn.Close(status, reason)
			_ = upstreamConn.Close(status, reason)
		})
	}

	go func() {
		errCh <- proxyLoop(ctx, clientConn, upstreamConn)
	}()

	go func() {
		errCh <- proxyLoop(ctx, upstreamConn, clientConn)
	}()

	err = <-errCh
	switch {
	case err == nil:
		p.logger.Info("transcription websocket closed cleanly", "remote_addr", r.RemoteAddr)
		closeBoth(websocket.StatusNormalClosure, "")
	case websocket.CloseStatus(err) >= 0:
		p.logger.Info("transcription websocket closed", "remote_addr", r.RemoteAddr, "status", websocket.CloseStatus(err))
		closeBoth(websocket.CloseStatus(err), websocket.CloseStatus(err).String())
	default:
		p.logger.Warn("transcription proxy error", "error", err)
		closeBoth(websocket.StatusInternalError, "transcription proxy error")
	}
}

func proxyLoop(ctx context.Context, source *websocket.Conn, target *websocket.Conn) error {
	for {
		messageType, payload, err := source.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) == websocket.StatusNormalClosure {
				return nil
			}
			return err
		}

		if err := target.Write(ctx, messageType, payload); err != nil {
			return err
		}
	}
}

func defaultSessionUpdate(cfg config.TranscriptionConfig) ([]byte, error) {
	if cfg.Model == "" {
		return nil, nil
	}

	body := map[string]any{
		"type":               "transcription_session.update",
		"input_audio_format": cfg.InputAudioFormat,
		"input_audio_transcription": map[string]any{
			"model": cfg.Model,
		},
	}

	transcription := body["input_audio_transcription"].(map[string]any)
	if cfg.Prompt != "" {
		transcription["prompt"] = cfg.Prompt
	}
	if cfg.Language != "" {
		transcription["language"] = cfg.Language
	}
	if cfg.NoiseReductionType != "" {
		body["input_audio_noise_reduction"] = map[string]any{
			"type": cfg.NoiseReductionType,
		}
	}
	if cfg.UseServerVAD {
		body["turn_detection"] = map[string]any{
			"type":                "server_vad",
			"threshold":           cfg.VADThreshold,
			"prefix_padding_ms":   cfg.PrefixPaddingMS,
			"silence_duration_ms": cfg.SilenceDurationMS,
		}
	}
	if len(cfg.Include) > 0 {
		body["include"] = cfg.Include
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal default session update: %w", err)
	}
	return payload, nil
}
