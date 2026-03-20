package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
)

const (
	defaultAddr                  = ":4230"
	defaultSearchMaxResults      = 100
	defaultTranscriptionUpstream = "wss://api.openai.com/v1/realtime?intent=transcription"
	defaultTranscriptionModel    = "gpt-4o-transcribe"
	defaultInputAudioFormat      = "pcm16"
	defaultNoiseReduction        = "near_field"
	defaultVADThreshold          = 0.5
	defaultPrefixPaddingMS       = 300
	defaultSilenceDurationMS     = 500
)

type Config struct {
	Addr           string
	AllowedOrigins []string
	AuthToken      string
	Filesystem     FilesystemConfig
	LogLevel       slog.Level
	Terminal       TerminalConfig
	Transcription  TranscriptionConfig
}

type FilesystemConfig struct {
	AllowedRoots     []string
	IncludeHidden    bool
	SearchMaxResults int
}

type TranscriptionConfig struct {
	APIKey             string
	Include            []string
	InputAudioFormat   string
	Language           string
	Model              string
	NoiseReductionType string
	PrefixPaddingMS    int
	Prompt             string
	SilenceDurationMS  int
	UpstreamURL        string
	UseServerVAD       bool
	VADThreshold       float64
}

type TerminalConfig struct {
	Binary string
	Home   string
}

func Load() (Config, error) {
	searchMaxResults, err := envInt("MODEX_FS_SEARCH_MAX_RESULTS", defaultSearchMaxResults)
	if err != nil {
		return Config{}, err
	}

	vadThreshold, err := envFloat("MODEX_TRANSCRIPTION_VAD_THRESHOLD", defaultVADThreshold)
	if err != nil {
		return Config{}, err
	}

	prefixPaddingMS, err := envInt("MODEX_TRANSCRIPTION_PREFIX_PADDING_MS", defaultPrefixPaddingMS)
	if err != nil {
		return Config{}, err
	}

	silenceDurationMS, err := envInt("MODEX_TRANSCRIPTION_SILENCE_DURATION_MS", defaultSilenceDurationMS)
	if err != nil {
		return Config{}, err
	}

	useServerVAD, err := envBool("MODEX_TRANSCRIPTION_VAD", true)
	if err != nil {
		return Config{}, err
	}

	includeHidden, err := envBool("MODEX_FS_INCLUDE_HIDDEN", false)
	if err != nil {
		return Config{}, err
	}

	logLevel, err := envLogLevel("MODEX_SIDECAR_LOG_LEVEL", slog.LevelWarn)
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		Addr:           envStringAny([]string{"MODEX_SIDECAR_ADDR"}, defaultAddr),
		AllowedOrigins: splitCSVAny([]string{"MODEX_SIDECAR_ALLOWED_ORIGINS"}),
		AuthToken:      strings.TrimSpace(envStringAny([]string{"MODEX_SIDECAR_AUTH_TOKEN"}, "")),
		Filesystem: FilesystemConfig{
			AllowedRoots:     splitCSVAny([]string{"MODEX_FS_ROOTS", "MODEX_SIDECAR_FS_ROOTS"}),
			IncludeHidden:    includeHidden,
			SearchMaxResults: searchMaxResults,
		},
		LogLevel: logLevel,
		Terminal: TerminalConfig{
			Binary: envStringAny([]string{"MODEX_TMUY_BIN"}, "tmuy"),
			Home:   strings.TrimSpace(envStringAny([]string{"MODEX_TMUY_HOME"}, "")),
		},
		Transcription: TranscriptionConfig{
			APIKey:             strings.TrimSpace(os.Getenv("OPENAI_API_KEY")),
			Include:            splitCSVAny([]string{"MODEX_TRANSCRIPTION_INCLUDE"}),
			InputAudioFormat:   envStringAny([]string{"MODEX_TRANSCRIPTION_INPUT_AUDIO_FORMAT"}, defaultInputAudioFormat),
			Language:           strings.TrimSpace(envStringAny([]string{"MODEX_TRANSCRIPTION_LANGUAGE"}, "")),
			Model:              envStringAny([]string{"MODEX_TRANSCRIPTION_MODEL"}, defaultTranscriptionModel),
			NoiseReductionType: envStringAny([]string{"MODEX_TRANSCRIPTION_NOISE_REDUCTION"}, defaultNoiseReduction),
			PrefixPaddingMS:    prefixPaddingMS,
			Prompt:             envStringAny([]string{"MODEX_TRANSCRIPTION_PROMPT"}, ""),
			SilenceDurationMS:  silenceDurationMS,
			UpstreamURL: envStringAny(
				[]string{"MODEX_TRANSCRIPTION_UPSTREAM_URL", "MODEX_SIDECAR_OPENAI_REALTIME_URL"},
				defaultTranscriptionUpstream,
			),
			UseServerVAD: useServerVAD,
			VADThreshold: vadThreshold,
		},
	}

	return cfg, nil
}

func envString(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	return value
}

func envBool(key string, fallback bool) (bool, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}

	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("%s: parse bool: %w", key, err)
	}

	return parsed, nil
}

func envFloat(key string, fallback float64) (float64, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}

	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0, fmt.Errorf("%s: parse float: %w", key, err)
	}

	return parsed, nil
}

func envInt(key string, fallback int) (int, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("%s: parse int: %w", key, err)
	}

	return parsed, nil
}

func envLogLevel(key string, fallback slog.Level) (slog.Level, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}

	var level slog.Level
	if err := level.UnmarshalText([]byte(strings.ToUpper(value))); err != nil {
		return 0, fmt.Errorf("%s: parse log level: %w", key, err)
	}

	return level, nil
}

func envStringAny(keys []string, fallback string) string {
	for _, key := range keys {
		value := strings.TrimSpace(os.Getenv(key))
		if value != "" {
			return value
		}
	}

	return fallback
}

func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}

	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		result = append(result, trimmed)
	}

	return result
}

func splitCSVAny(keys []string) []string {
	for _, key := range keys {
		value := splitCSV(os.Getenv(key))
		if len(value) > 0 {
			return value
		}
	}

	return nil
}
