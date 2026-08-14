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

/**
 * Run the security CLI. Resolves undefined on exit 44 (item not found →
 * absence, not failure). Rejects with a sanitized error: execFile's
 * error.message embeds the full command line, which for `set` would leak the
 * plaintext secret into logs — so we only surface the exit code and stderr
 * (security never echoes argv to stderr).
 */
function security(args, description) {
	return new Promise((resolvePromise, reject) => {
		execFile(SECURITY, args, { timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
			if (error) {
				if (error.code === 44) return resolvePromise(void 0);
				const detail = typeof error.code === "number" ? `exit ${error.code}` : (error.killed ? `timeout after ${TIMEOUT_MS}ms` : String(error.code));
				const trimmed = (stderr ?? "").trim();
				return reject(new Error(`credentials-keychain: ${description} failed (${detail})${trimmed ? `: ${trimmed}` : ""}`));
			}
			resolvePromise(stdout.replace(/\n$/, ""));
		});
	});
}

/** True when the item exists, without reading its value into this process. */
async function keychainHas(service, ref) {
	return await security(["find-generic-password", "-s", service, "-a", ref], `existence check of "${ref}"`) !== void 0;
}

export default class KeychainCredentialProvider extends CredentialProvider {
	constructor(ctx, config) {
		if (process.platform !== "darwin") {
			throw new Error("credentials-keychain: this provider supports macOS only (contributions for libsecret/Windows Credential Manager welcome)");
		}
		super(ctx);
		this.config = config ?? {};
		if (this.config.service !== void 0 && typeof this.config.service !== "string") {
			throw new Error("credentials-keychain: config.service must be a string");
		}
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
		// Existence check only — deliberately does NOT read the value (no -w),
		// so a status query never pulls the plaintext into this process.
		if (await keychainHas(this.service, ref)) return { configured: true, source: "keychain", writable: true };
		return { configured: false, writable: true };
	}

	async set(ref, value) {
		if (value.length === 0) throw new Error(`credentials-keychain: an empty value cannot be stored for "${ref}"; use unset`);
		if (this.inherited(ref) !== void 0) throw new Error(`credentials-keychain: "${ref}" is shadowed by the process environment; unset it there first`);
		// -U updates in place when the item already exists. Known limitation: the
		// security CLI only accepts the value via argv, so it is briefly visible
		// to same-user processes running `ps`; there is no stdin path.
		await security(["add-generic-password", "-U", "-s", this.service, "-a", ref, "-w", value], `write of "${ref}"`);
		this.notifyUpdated(ref);
	}

	async unset(ref) {
		// Notify only when something was actually deleted — deleting an absent
		// ref is a no-op and must not announce a change.
		if (await keychainHas(this.service, ref)) {
			await security(["delete-generic-password", "-s", this.service, "-a", ref], `delete of "${ref}"`);
			this.notifyUpdated(ref);
		}
	}
}
