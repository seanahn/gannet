# Gannet — development install, packaging, and marketplace publish
#
# Publishing needs the same one-time setup as Perch: the seanahn publisher, and an Azure DevOps PAT
# (Marketplace > Manage) either from 'make login', in ~/.ssh/azure-dev.pat, or as VSCE_PAT=<token> in .env.
#
-include .env
PAT_FILE = $(HOME)/.ssh/azure-dev.pat
ifeq ($(VSCE_PAT),)
VSCE_PAT = $(shell [ -r $(PAT_FILE) ] && tr -d '\n' < $(PAT_FILE))
endif
export VSCE_PAT

VSCE = npx --yes @vscode/vsce
VERSION = $(shell node -p "require('./package.json').version")
PUBLISHER = $(shell node -p "require('./package.json').publisher")
VSIX = gannet-$(VERSION).vsix

EXT_ID = seanahn.gannet-$(VERSION)
# links made under earlier versions
OLD_IDS = seanahn.gannet-0.1.0 seanahn.gannet-0.2.0
EXT_DIRS = /home/sahn/.vscode/extensions /home/sahn/.local/share/code-server/extensions /home/sahn/.vscode-server/extensions

## Install runtime dependencies (there are none; kept so `install` stays the same)
deps:
	npm install --omit=dev --silent

## Syntax-check the extension sources
check:
	npm run -s check

## Offline tests, then the live one against GitHub (uses gh's real logins)
test:
	npm run -s test

## Offline tests only: no network
test-offline:
	npm run -s test:offline

## Symlink this checkout into every VS Code / code-server extension dir
install: deps check
	@for d in $(EXT_DIRS); do for o in $(OLD_IDS); do rm -f $$d/$$o; done; [ -d $$d ] && ln -sfn /git/gannet $$d/$(EXT_ID) && echo "linked $$d/$(EXT_ID)"; done; true
	@echo "gannet installed. Reload the window to activate."

## Remove the symlinks
uninstall:
	@for d in $(EXT_DIRS); do rm -f $$d/$(EXT_ID); for o in $(OLD_IDS); do rm -f $$d/$$o; done; done; echo "gannet unlinked"

## Build a .vsix
package: deps check
	$(VSCE) package

## Install the packaged .vsix into this machine's VS Code, in place of the development symlink
install-vsix: package uninstall
	@command -v code-server >/dev/null 2>&1 && code-server --install-extension $(VSIX) --force \
		|| code --install-extension $(VSIX) --force

## One-time: store the marketplace PAT for the publisher in package.json
login:
	$(VSCE) login $(PUBLISHER)

## Publish the version in package.json to the marketplace
publish: deps check
	$(VSCE) publish

clean:
	rm -f *.vsix

.PHONY: deps check test test-offline install uninstall package install-vsix login publish clean
