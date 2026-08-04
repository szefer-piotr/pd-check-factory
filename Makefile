# Local UI: Step API (8787) + Vite frontend (5173)
# Usage: make dev

API_HOST ?= 127.0.0.1
API_PORT ?= 8787
OUTPUT_DIR ?= output
PDCHECK ?= $(shell if [ -x .venv/bin/pdcheck ]; then echo .venv/bin/pdcheck; else echo pdcheck; fi)

.PHONY: dev api frontend install

dev:
	@echo "API  → http://$(API_HOST):$(API_PORT)"
	@echo "UI   → http://127.0.0.1:5173/#/study"
	@trap 'kill 0' EXIT INT TERM; \
		$(MAKE) api & \
		$(MAKE) frontend & \
		wait

api:
	$(PDCHECK) ui step-api --host $(API_HOST) --port $(API_PORT) --output-dir $(OUTPUT_DIR)

frontend:
	cd frontend && npm run dev

install:
	pip install -e .
	cd frontend && npm install
