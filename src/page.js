'use strict';
// The sidebar page's HTML shell: the theme-coloured styles, the two parts (workspaces, rows) and media/page.js.

const CSS = `
  body { margin: 0; padding: 0; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); user-select: none; }
  svg { width: 16px; height: 16px; display: block; }
  #ws { padding: 2px 0; }
  hr { border: 0; border-top: 1px solid var(--vscode-widget-border, transparent); margin: 2px 0; }
  .ws, .row { display: flex; align-items: center; height: 22px; line-height: 22px; white-space: nowrap; overflow: hidden; cursor: pointer; padding-right: 4px; }
  .ws { padding-left: 12px; }
  .ws:hover, .row:hover { background: var(--vscode-list-hoverBackground); }
  .ws.missing .label { opacity: 0.6; }
  .label { overflow: hidden; text-overflow: ellipsis; flex: none; max-width: 100%; }
  .desc { margin-left: 6px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; font-size: 0.92em; }
  .tw { width: 16px; min-width: 16px; display: inline-flex; justify-content: center; margin-right: 4px; }
  .ws .lic { margin-right: 4px; margin-left: -2px; display: inline-flex; }
  .ic { display: inline-flex; margin-right: 6px; }
  .green { color: var(--vscode-charts-green); }
  .chev svg { transition: transform 0.1s; }
  .chev.open svg { transform: rotate(90deg); }
  .spin svg { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .acts { margin-left: auto; display: none; padding-left: 4px; }
  .ws:hover .acts, .row:hover .acts { display: inline-flex; }
  .act { background: none; border: 0; color: inherit; padding: 2px; margin: 0; cursor: pointer; display: inline-flex; border-radius: 3px; }
  .act:hover { background: var(--vscode-list-hoverBackground); }
  #tree { outline: none; }
  #tree:focus .row.focused { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;
    background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
`;

function pageHtml({ cspSource, scriptUri, nonce }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${CSS}</style></head>
<body><div id="ws"></div><hr><div id="tree" role="tree" tabindex="0"></div>
<script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
}

module.exports = { pageHtml };
