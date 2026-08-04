# Grok Desk — developer convenience targets.
#
# Open-source build: product keys are not required. `make local` and `make dev`
# both launch the desktop app ready to use (no activation gate).

SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help local dev install build test typecheck

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

local: ## Run the desktop app in dev (alias of dev; no product key required)
	pnpm dev

dev: ## Run the desktop app in dev
	pnpm dev

install: ## Install workspace dependencies
	pnpm install

build: ## Build all packages
	pnpm build

test: ## Run all tests
	pnpm test

typecheck: ## Typecheck all packages
	pnpm typecheck
