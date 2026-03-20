package server

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"

	"modex/backend/sidecar/internal/config"
	"modex/backend/sidecar/internal/filesystem"
	"modex/backend/sidecar/internal/terminal"
	"modex/backend/sidecar/internal/transcription"
)

func New(cfg config.Config, logger *slog.Logger) (*http.Server, error) {
	filesystemService, err := filesystem.New(cfg.Filesystem)
	if err != nil {
		return nil, fmt.Errorf("filesystem service: %w", err)
	}

	transcriptionProxy, err := transcription.NewProxy(cfg.Transcription, logger)
	if err != nil {
		return nil, fmt.Errorf("transcription proxy: %w", err)
	}
	terminalService := terminal.New(cfg.Terminal)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"authRequired":            cfg.AuthToken != "",
			"filesystemRoots":         filesystemService.Roots(),
			"ok":                      true,
			"terminalConfigured":      cfg.Terminal.Binary != "",
			"transcriptionConfigured": cfg.Transcription.APIKey != "",
		})
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"name":    "modex-sidecar",
			"version": 1,
			"ws": map[string]string{
				"terminal":       "/ws/terminal",
				"terminalAttach": "/ws/terminal/attach",
				"filesystem":     "/ws/filesystem",
				"transcription":  "/ws/transcription",
			},
		})
	})
	guard := withGuards(logger, cfg.AllowedOrigins, cfg.AuthToken)
	mux.Handle("/ws/filesystem", guard(filesystem.Handler(filesystemService, logger)))
	mux.Handle("/ws/terminal", guard(terminal.ControlHandler(terminalService, logger)))
	mux.Handle("/ws/terminal/attach", guard(terminal.AttachHandler(terminalService, logger)))
	mux.Handle("/ws/transcription", guard(http.HandlerFunc(transcriptionProxy.Handler)))

	return &http.Server{
		Addr:    cfg.Addr,
		Handler: mux,
	}, nil
}

func withGuards(logger *slog.Logger, allowedOrigins []string, authToken string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowed[origin] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := strings.TrimSpace(r.Header.Get("Origin"))
			if origin != "" && !originAllowed(origin, r.Host, allowed) {
				logger.Warn("rejected request with disallowed origin", "origin", origin, "path", r.URL.Path, "remote_addr", r.RemoteAddr)
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}

			if authToken != "" && !authorized(r, authToken) {
				logger.Warn("rejected request with invalid auth token", "path", r.URL.Path, "remote_addr", r.RemoteAddr)
				http.Error(w, "unauthorized websocket client", http.StatusUnauthorized)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func originAllowed(origin string, requestHost string, allowed map[string]struct{}) bool {
	if len(allowed) > 0 {
		_, ok := allowed[origin]
		return ok
	}

	originURL, err := url.Parse(origin)
	if err != nil {
		return false
	}

	originHost := normalizeHost(originURL.Hostname())
	targetHost := normalizeHost(hostnameFromRequestHost(requestHost))
	if originHost == "" || targetHost == "" {
		return false
	}

	if originHost == targetHost {
		return true
	}

	return isLoopbackHost(originHost) && isLoopbackHost(targetHost)
}

func hostnameFromRequestHost(host string) string {
	trimmed := strings.TrimSpace(host)
	if trimmed == "" {
		return ""
	}

	parsedHost, _, err := net.SplitHostPort(trimmed)
	if err == nil {
		return parsedHost
	}

	return trimmed
}

func normalizeHost(host string) string {
	return strings.Trim(strings.ToLower(strings.TrimSpace(host)), "[]")
}

func isLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}

	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func authorized(r *http.Request, authToken string) bool {
	if authToken == "" {
		return true
	}

	if token := strings.TrimSpace(r.URL.Query().Get("token")); token != "" {
		return token == authToken
	}

	authorization := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
		return strings.TrimSpace(authorization[7:]) == authToken
	}

	return false
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
