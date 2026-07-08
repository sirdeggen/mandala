package main

import "testing"

// envMap adapts a map into the envLookup shape loadConfig expects, so tests
// never touch real process environment variables.
func envMap(vars map[string]string) envLookup {
	return func(name string) string { return vars[name] }
}

// requiredEnv returns the minimal set of required vars loadConfig needs to
// succeed, so each test only needs to override what it's actually checking.
func requiredEnv() map[string]string {
	return map[string]string{
		"NODE_NAME":          "mandala",
		"SERVER_PRIVATE_KEY": "deadbeef",
		"HOSTING_URL":        "http://localhost:8081",
		"MONGO_URL":          "mongodb://localhost:27017",
		"NETWORK":            "test",
	}
}

// TestLoadConfigReadsArcadeCallbackToken pins the final-review fix: loadConfig
// must read the optional ARCADE_CALLBACK_TOKEN var into
// wiring.Config.ArcadeCallbackToken so it reaches WithArcade's /arc-ingest
// guard end to end.
func TestLoadConfigReadsArcadeCallbackToken(t *testing.T) {
	vars := requiredEnv()
	vars["ARCADE_CALLBACK_TOKEN"] = "shh-secret"

	cfg, err := loadConfig(envMap(vars))
	if err != nil {
		t.Fatal("loadConfig:", err)
	}
	if cfg.ArcadeCallbackToken != "shh-secret" {
		t.Fatalf("ArcadeCallbackToken = %q, want %q", cfg.ArcadeCallbackToken, "shh-secret")
	}
}

// TestLoadConfigArcadeCallbackTokenDefaultsEmpty confirms the var is genuinely
// optional: leaving it unset must not error and must leave the field empty
// (WithArcade/hasValidCallbackToken treat empty as "no token check").
func TestLoadConfigArcadeCallbackTokenDefaultsEmpty(t *testing.T) {
	cfg, err := loadConfig(envMap(requiredEnv()))
	if err != nil {
		t.Fatal("loadConfig:", err)
	}
	if cfg.ArcadeCallbackToken != "" {
		t.Fatalf("ArcadeCallbackToken = %q, want empty when unset", cfg.ArcadeCallbackToken)
	}
}

// TestLoadConfigMissingRequiredVarFails is a sanity check that the required/
// optional split still works alongside the new optional var: a missing
// required var still fails fast by name, unaffected by ARCADE_CALLBACK_TOKEN.
func TestLoadConfigMissingRequiredVarFails(t *testing.T) {
	vars := requiredEnv()
	delete(vars, "NODE_NAME")

	_, err := loadConfig(envMap(vars))
	if err == nil {
		t.Fatal("loadConfig: want error for missing NODE_NAME, got nil")
	}
}
