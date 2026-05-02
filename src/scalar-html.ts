import { type OpenApiDocument } from "./openapi-types.js";

const DEFAULT_SCALAR_CDN = "https://cdn.jsdelivr.net/npm/@scalar/api-reference";

export type RenderScalarHtmlOptions = {
	pageTitle?: string;
	cdnScriptUrl?: string;
	customCss?: string;
};

export function renderScalarHtml(document: OpenApiDocument, options: RenderScalarHtmlOptions = {}): string {
	const pageTitle = options.pageTitle ?? document.info.title;
	const cdnScriptUrl = options.cdnScriptUrl ?? DEFAULT_SCALAR_CDN;
	const customCss = options.customCss ?? `
		.scalar-app .introduction-section h1,
		.scalar-app .introduction-section p,
		.scalar-app .introduction-section .badge,
		.scalar-app .introduction-section .servers,
		.scalar-app .introduction-section [data-testid="document-version"] {
			display: none !important;
		}

		.scalar-app .references-header {
			display: none !important;
		}

		.scalar-app {
			min-height: 100vh;
		}
	`;

	return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(pageTitle)}</title>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 100%; min-height: 100%; }
      #scalar-root { min-height: 100vh; }
    </style>
    <script src="${escapeHtml(cdnScriptUrl)}"></script>
  </head>
  <body>
    <div id="scalar-root"></div>
    <script>
      Scalar.createApiReference('#scalar-root', {
        theme: 'default',
        darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
        layout: 'modern',
        showSidebar: true,
        hideModels: true,
        documentDownloadType: 'both',
        hideTestRequestButton: true,
        hideClientButton: true,
        hiddenClients: true,
        showOperationId: false,
        showDeveloperTools: 'never',
        metaData: { title: ${JSON.stringify(pageTitle)} },
        customCss: ${JSON.stringify(customCss)},
        content: ${JSON.stringify(document)},
      });

      queueMicrotask(() => {
        const buttons = document.querySelectorAll('.download-container .download-button span');
        if (buttons.length >= 2) {
          buttons[0].textContent = 'Download OpenAPI JSON';
          buttons[1].textContent = 'Download OpenAPI YAML';
        }
      });
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}