package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"modex/backend/sidecar/internal/config"
	"modex/backend/sidecar/internal/server"
)

func main() {
	bootstrapLogger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelWarn}))

	loadedEnvFiles, err := config.LoadDotEnv()
	if err != nil {
		bootstrapLogger.Error("load dotenv", "error", err)
		os.Exit(1)
	}

	cfg, err := config.Load()
	if err != nil {
		bootstrapLogger.Error("load config", "error", err)
		os.Exit(1)
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	if len(loadedEnvFiles) > 0 {
		logger.Info("loaded dotenv files", "files", loadedEnvFiles)
	}

	httpServer, err := server.New(cfg, logger)
	if err != nil {
		logger.Error("create server", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()

		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			logger.Warn("shutdown error", "error", err)
		}
	}()

	logger.Info(
		"starting modex sidecar",
		"addr",
		cfg.Addr,
		"allowed_origins",
		cfg.AllowedOrigins,
		"auth_required",
		cfg.AuthToken != "",
		"filesystem_roots",
		cfg.Filesystem.AllowedRoots,
		"transcription_configured",
		cfg.Transcription.APIKey != "",
	)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("listen", "error", err)
		os.Exit(1)
	}
}
