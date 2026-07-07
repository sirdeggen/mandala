//go:build tools

// Package tools pins module requirements that no shipped code imports yet.
// Task 13's HTTP server uses fiber; without this blank import `go mod tidy`
// would strip the pinned github.com/gofiber/fiber/v2 requirement (see
// README "Pinned dependencies"). The `tools` build tag keeps this file out
// of every real build.
package tools

import _ "github.com/gofiber/fiber/v2"
