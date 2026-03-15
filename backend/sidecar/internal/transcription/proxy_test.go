package transcription

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"modex/backend/sidecar/internal/config"
)

func TestProxySendsDefaultSessionAndForwardsMessages(t *testing.T) {
	t.Parallel()

	upstreamReceived := make(chan string, 2)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Errorf("accept upstream websocket: %v", err)
			return
		}
		defer conn.Close(websocket.StatusNormalClosure, "")

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		_, first, err := conn.Read(ctx)
		if err != nil {
			t.Errorf("read default session: %v", err)
			return
		}
		upstreamReceived <- string(first)

		_, second, err := conn.Read(ctx)
		if err != nil {
			t.Errorf("read forwarded message: %v", err)
			return
		}
		upstreamReceived <- string(second)

		if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"input_audio_buffer.committed","item_id":"item-1"}`)); err != nil {
			t.Errorf("write upstream event: %v", err)
		}
	}))
	defer upstream.Close()

	proxy, err := NewProxy(config.TranscriptionConfig{
		APIKey:             "test-key",
		InputAudioFormat:   "pcm16",
		Model:              "gpt-4o-transcribe",
		NoiseReductionType: "near_field",
		PrefixPaddingMS:    300,
		SilenceDurationMS:  500,
		UpstreamURL:        toWebSocketURL(upstream.URL),
		UseServerVAD:       true,
		VADThreshold:       0.5,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("new proxy: %v", err)
	}

	sidecar := httptest.NewServer(http.HandlerFunc(proxy.Handler))
	defer sidecar.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	clientConn, _, err := websocket.Dial(ctx, toWebSocketURL(sidecar.URL), nil)
	if err != nil {
		t.Fatalf("dial sidecar websocket: %v", err)
	}
	defer clientConn.Close(websocket.StatusNormalClosure, "")

	if err := clientConn.Write(ctx, websocket.MessageText, []byte(`{"type":"input_audio_buffer.append","audio":"Zm9v"}`)); err != nil {
		t.Fatalf("write client message: %v", err)
	}

	first := <-upstreamReceived
	if !strings.Contains(first, `"type":"transcription_session.update"`) {
		t.Fatalf("expected default session update, got %s", first)
	}

	second := <-upstreamReceived
	if second != `{"type":"input_audio_buffer.append","audio":"Zm9v"}` {
		t.Fatalf("unexpected forwarded payload %s", second)
	}

	_, event, err := clientConn.Read(ctx)
	if err != nil {
		t.Fatalf("read client event: %v", err)
	}
	if string(event) != `{"type":"input_audio_buffer.committed","item_id":"item-1"}` {
		t.Fatalf("unexpected client event %s", string(event))
	}
}

func toWebSocketURL(httpURL string) string {
	return "ws" + strings.TrimPrefix(httpURL, "http")
}
