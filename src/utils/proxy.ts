import axios from "axios"
import * as vscode from "vscode"
import { setGlobalDispatcher } from "undici"
import { ProxyAgent } from "proxy-agent"

import { Package } from "../shared/package"

/**
 * Configures global networking libraries to use a proxy when provided.
 *
 * The proxy URL is resolved from the following sources (in order):
 * 1. Function argument
 * 2. VS Code setting `roo-cline.proxyUrl`
 * 3. Environment variables `ROO_CODE_PROXY_URL`, `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`
 *
 * If a proxy URL is found, a {@link ProxyAgent} is created and applied to
 * global fetch via {@link setGlobalDispatcher}. Axios default agents are also
 * configured and axios' internal proxy handling is disabled.
 */
export function setupProxy(proxyUrl?: string) {
	const configUrl = vscode.workspace.getConfiguration(Package.name).get<string>("proxyUrl")
	const envUrl =
		process.env.ROO_CODE_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY

	const url = proxyUrl || configUrl || envUrl

	if (!url) {
		return
	}

	const agent = new ProxyAgent(url)
	setGlobalDispatcher(agent)

	axios.defaults.httpAgent = agent as any
	axios.defaults.httpsAgent = agent as any
	axios.defaults.proxy = false
}
