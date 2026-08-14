/**
 * macOS Keychain credentials provider for DeepSeek Harness.
 *
 * Replaces the file-backed dsh-credentials-local provider: secret values live
 * in the user's login keychain (service "dsh-credentials", account = ref name)
 * instead of a 0600 file that the agent's tool processes can read.
 *
 * Layering keeps the seam's semantics: the inherited process environment
 * shadows the keychain (per-run operator intent wins), an empty stored value
 * is absent, and writes reject while a read-only source shadows the ref.
 */
import { execFile } from "node:child_process";
import { CredentialProvider } from "@deepseek-ai/dsh-credentials";

const DEFAULT_SERVICE = "dsh-credentials";
const SECURITY = "/usr/bin/security";
const TIMEOUT_MS = 10000;

function security(args, description) {
	return new Promise((resolvePromise, reject) => {
		execFile(SECURITY, args, { timeout: TIMEOUT_MS }, (error, stdout) => {
			if (error) {
				// exit 44 = "The specified item could not be found" → absence, not failure
				if (error.code === 44) return resolvePromise(void 0);
				return reject(new Error(`credentials-keychain: ${description} failed: ${error.message}`));
			}
			resolvePromise(stdout.replace(/\n$/, ""));
		});
	});
}

export default class KeychainCredentialProvider extends CredentialProvider {
	constructor(ctx, config) {
		if (process.platform !== "darwin") {
			throw new Error("credentials-keychain: this provider supports macOS only (contributions for libsecret/Windows Credential Manager welcome)");
		}
		super(ctx);
		this.config = config ?? {};
		this.service = this.config.service ?? DEFAULT_SERVICE;
	}

	inherited(ref) {
		const value = process.env[ref];
		return value !== void 0 && value.length > 0 ? value : void 0;
	}

	async keychainGet(ref) {
		return security(["find-generic-password", "-s", this.service, "-a", ref, "-w"], `read of "${ref}"`);
	}

	async resolve(ref) {
		const inherited = this.inherited(ref);
		if (inherited !== void 0) return { value: inherited, source: "env" };
		const stored = await this.keychainGet(ref);
		if (stored !== void 0 && stored.length > 0) return { value: stored, source: "keychain" };
		return void 0;
	}

	async describe(ref) {
		if (this.inherited(ref) !== void 0) return { configured: true, source: "env", writable: false };
		const stored = await this.keychainGet(ref);
		if (stored !== void 0 && stored.length > 0) return { configured: true, source: "keychain", writable: true };
		return { configured: false, writable: true };
	}

	async set(ref, value) {
		if (value.length === 0) throw new Error(`credentials-keychain: an empty value cannot be stored for "${ref}"; use unset`);
		if (this.inherited(ref) !== void 0) throw new Error(`credentials-keychain: "${ref}" is shadowed by the process environment; unset it there first`);
		// -U updates in place when the item already exists
		await security(["add-generic-password", "-U", "-s", this.service, "-a", ref, "-w", value], `write of "${ref}"`);
		this.notifyUpdated(ref);
	}

	async unset(ref) {
		await security(["delete-generic-password", "-s", this.service, "-a", ref], `delete of "${ref}"`);
		this.notifyUpdated(ref);
	}
}
