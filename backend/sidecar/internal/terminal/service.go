package terminal

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"strconv"

	"modex/backend/sidecar/internal/config"
)

type Service struct {
	binary string
	home   string
}

type SessionSummary struct {
	CreatedAt   string `json:"createdAt"`
	Cwd         string `json:"cwd"`
	CurrentName string `json:"currentName"`
	DetachKey   string `json:"detachKey"`
	ExitCode    *int   `json:"exitCode"`
	IDHash      string `json:"idHash"`
	LogPath     string `json:"logPath"`
	SocketPath  string `json:"socketPath"`
	StartedName string `json:"startedName"`
	Status      string `json:"status"`
	UpdatedAt   string `json:"updatedAt"`
}

type tmuySessionRecord struct {
	CreatedAt   string `json:"created_at"`
	Cwd         string `json:"cwd"`
	CurrentName string `json:"current_name"`
	DetachKey   string `json:"detach_key"`
	ExitCode    *int   `json:"exit_code"`
	IDHash      string `json:"id_hash"`
	LogPath     string `json:"log_path"`
	SocketPath  string `json:"socket_path"`
	StartedName string `json:"started_name"`
	Status      string `json:"status"`
	UpdatedAt   string `json:"updated_at"`
}

func New(cfg config.TerminalConfig) *Service {
	return &Service{
		binary: cfg.Binary,
		home:   cfg.Home,
	}
}

func (s *Service) ListSessions(ctx context.Context) ([]SessionSummary, error) {
	var records []tmuySessionRecord
	if err := s.runJSON(ctx, "", &records, "--json", "ls", "--all"); err != nil {
		return nil, err
	}

	sessions := make([]SessionSummary, 0, len(records))
	for _, record := range records {
		sessions = append(sessions, mapSummary(record))
	}
	return sessions, nil
}

func (s *Service) CreateSession(ctx context.Context, cwd string) (SessionSummary, error) {
	if cwd == "" {
		return SessionSummary{}, errors.New("cwd is required")
	}

	var record tmuySessionRecord
	if err := s.runJSON(ctx, cwd, &record, "--json", "new", "--detached"); err != nil {
		return SessionSummary{}, err
	}
	return mapSummary(record), nil
}

func (s *Service) InspectSession(ctx context.Context, target string) (SessionSummary, error) {
	if target == "" {
		return SessionSummary{}, errors.New("target is required")
	}

	var record tmuySessionRecord
	if err := s.runJSON(ctx, "", &record, "--json", "inspect", target); err != nil {
		return SessionSummary{}, err
	}
	return mapSummary(record), nil
}

func (s *Service) AttachSession(ctx context.Context, target string, rows int, cols int) (*net.UnixConn, SessionSummary, error) {
	session, err := s.InspectSession(ctx, target)
	if err != nil {
		return nil, SessionSummary{}, err
	}

	addr := &net.UnixAddr{Name: session.SocketPath, Net: "unix"}
	conn, err := net.DialUnix("unix", nil, addr)
	if err != nil {
		return nil, SessionSummary{}, fmt.Errorf("dial session socket: %w", err)
	}

	if _, err := conn.Write(sizePayload('A', rows, cols)); err != nil {
		_ = conn.Close()
		return nil, SessionSummary{}, fmt.Errorf("write attach handshake: %w", err)
	}

	return conn, session, nil
}

func (s *Service) ResizeSession(ctx context.Context, socketPath string, rows int, cols int) error {
	addr := &net.UnixAddr{Name: socketPath, Net: "unix"}
	conn, err := net.DialUnix("unix", nil, addr)
	if err != nil {
		return fmt.Errorf("dial resize socket: %w", err)
	}
	defer conn.Close()

	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}

	if _, err := conn.Write(sizePayload('R', rows, cols)); err != nil {
		return fmt.Errorf("write resize payload: %w", err)
	}

	return nil
}

func (s *Service) ReadLog(session SessionSummary) ([]byte, error) {
	if session.LogPath == "" {
		return nil, nil
	}

	data, err := os.ReadFile(session.LogPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read session log: %w", err)
	}

	return data, nil
}

func (s *Service) runJSON(ctx context.Context, dir string, target any, args ...string) error {
	cmd := exec.CommandContext(ctx, s.binary, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	if s.home != "" {
		cmd.Env = append(os.Environ(), "TMUY_HOME="+s.home)
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		var execErr *exec.Error
		if errors.As(err, &execErr) && errors.Is(execErr.Err, exec.ErrNotFound) {
			return fmt.Errorf("tmuy binary %q not found; set MODEX_TMUY_BIN", s.binary)
		}
		return fmt.Errorf("tmuy command failed: %s", bytes.TrimSpace(stderr.Bytes()))
	}

	if err := json.Unmarshal(stdout.Bytes(), target); err != nil {
		return fmt.Errorf("decode tmuy response: %w", err)
	}

	return nil
}

func mapSummary(record tmuySessionRecord) SessionSummary {
	return SessionSummary{
		CreatedAt:   record.CreatedAt,
		Cwd:         record.Cwd,
		CurrentName: record.CurrentName,
		DetachKey:   record.DetachKey,
		ExitCode:    record.ExitCode,
		IDHash:      record.IDHash,
		LogPath:     record.LogPath,
		SocketPath:  record.SocketPath,
		StartedName: record.StartedName,
		Status:      normalizeStatus(record.Status),
		UpdatedAt:   record.UpdatedAt,
	}
}

func normalizeStatus(raw string) string {
	switch raw {
	case "Starting", "starting":
		return "starting"
	case "Exited", "exited":
		return "exited"
	case "Failed", "failed":
		return "failed"
	default:
		return "live"
	}
}

func sizePayload(mode byte, rows int, cols int) []byte {
	clampedRows := clampDimension(rows)
	clampedCols := clampDimension(cols)
	return []byte{
		mode,
		byte(clampedRows >> 8),
		byte(clampedRows),
		byte(clampedCols >> 8),
		byte(clampedCols),
	}
}

func clampDimension(value int) int {
	if value < 1 {
		return 1
	}
	if value > int(^uint16(0)) {
		return int(^uint16(0))
	}
	return value
}

func parseDimension(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}

	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return clampDimension(value)
}

func copyChunks(dst io.Writer, src io.Reader) error {
	buf := make([]byte, 4096)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			if _, writeErr := dst.Write(buf[:n]); writeErr != nil {
				return writeErr
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
	}
}
