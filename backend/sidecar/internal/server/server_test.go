package server

import "testing"

func TestOriginAllowedWithConfiguredAllowlist(t *testing.T) {
	allowed := map[string]struct{}{
		"http://localhost:5173": {},
	}

	if !originAllowed("http://localhost:5173", "127.0.0.1:4230", allowed) {
		t.Fatal("expected configured origin to be allowed")
	}

	if originAllowed("http://127.0.0.1:5173", "127.0.0.1:4230", allowed) {
		t.Fatal("expected non-listed origin to be rejected when allowlist is configured")
	}
}

func TestOriginAllowedDefaultPolicyAcceptsSameHostAcrossPorts(t *testing.T) {
	allowed := map[string]struct{}{}

	if !originAllowed("http://100.69.229.117:5175", "100.69.229.117:4230", allowed) {
		t.Fatal("expected same-host origin to be allowed")
	}

	if !originAllowed("https://levi.taila510b.ts.net:5175", "levi.taila510b.ts.net:4230", allowed) {
		t.Fatal("expected same-host origin with hostname to be allowed")
	}
}

func TestOriginAllowedDefaultPolicyAcceptsLoopbackAliases(t *testing.T) {
	allowed := map[string]struct{}{}

	if !originAllowed("http://localhost:5173", "127.0.0.1:4230", allowed) {
		t.Fatal("expected loopback aliases to be allowed")
	}

	if !originAllowed("http://127.0.0.1:5173", "localhost:4230", allowed) {
		t.Fatal("expected loopback aliases to be allowed")
	}
}

func TestOriginAllowedDefaultPolicyRejectsDifferentHosts(t *testing.T) {
	allowed := map[string]struct{}{}

	if originAllowed("http://malicious.example:5173", "100.69.229.117:4230", allowed) {
		t.Fatal("expected different host origin to be rejected")
	}

	if originAllowed("not a url", "100.69.229.117:4230", allowed) {
		t.Fatal("expected invalid origin to be rejected")
	}
}
