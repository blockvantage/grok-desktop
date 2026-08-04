import type { AgentProvider } from "./provider.js";
import type { ModelDescriptor, ProviderHealth } from "./types.js";

/**
 * Registry of agent providers. Gateway composition root registers adapters here.
 */
export class ProviderRegistry {
  private providers = new Map<string, AgentProvider>();

  register(provider: AgentProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  get(providerId: string): AgentProvider | undefined {
    return this.providers.get(providerId);
  }

  require(providerId: string): AgentProvider {
    const p = this.get(providerId);
    if (!p) throw new Error(`Unknown provider: ${providerId}`);
    return p;
  }

  list(): AgentProvider[] {
    return [...this.providers.values()];
  }

  async probeAll(): Promise<ProviderHealth[]> {
    return Promise.all(this.list().map((p) => p.probe()));
  }

  async listAllModels(): Promise<ModelDescriptor[]> {
    const out: ModelDescriptor[] = [];
    for (const p of this.list()) {
      out.push(...(await p.listModels()));
    }
    return out;
  }
}
