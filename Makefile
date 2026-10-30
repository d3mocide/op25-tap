.DEFAULT_GOAL := help
COMPOSE       := docker compose
COMPOSE_DEV   := $(COMPOSE) -f docker-compose.dev.yml
COMPOSE_BUILD := $(COMPOSE) -f docker-compose.build.yml

.PHONY: help env up down restart pull logs ps build up-build dev dev-down dev-logs test web-build release

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

env: ## Create .env from .env.example if missing
	@test -f .env || (cp .env.example .env && echo "Created .env - set OP25_URL")

up: env ## Pull the published image and start it
	$(COMPOSE) pull
	$(COMPOSE) up -d

down: ## Stop the stack
	$(COMPOSE) down

restart: ## Restart the container
	$(COMPOSE) restart

pull: ## Update to the latest published image and restart
	$(COMPOSE) pull
	$(COMPOSE) up -d

logs: ## Tail container logs
	$(COMPOSE) logs -f --tail=100

ps: ## Show container status
	$(COMPOSE) ps

build: ## Build the production image locally
	$(COMPOSE_BUILD) build

up-build: env ## Build from source and start (no registry)
	$(COMPOSE_BUILD) up -d --build

dev: env ## Hot-reload dev stack (UI on :5173)
	$(COMPOSE_DEV) up --build -d

dev-down: ## Stop the dev stack
	$(COMPOSE_DEV) down

dev-logs: ## Tail dev stack logs
	$(COMPOSE_DEV) logs -f --tail=100

test: ## Run backend tests
	.venv/bin/pytest tests

web-build: ## Typecheck and build the frontend
	cd web && npm run build

release: ## Tag and push a release: make release VERSION=0.1.0
	@test -n "$(VERSION)" || (echo "usage: make release VERSION=X.Y.Z" && exit 1)
	@test -z "$$(git status --porcelain)" || (echo "working tree not clean" && exit 1)
	@test "$$(git rev-parse --abbrev-ref HEAD)" = main || (echo "not on main" && exit 1)
	git tag -a v$(VERSION) -m "v$(VERSION)"
	git push origin v$(VERSION)
