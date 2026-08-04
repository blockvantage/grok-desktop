import { describe, expect, it, vi } from "vitest";
import { nativeBindingNeedsRebuild } from "./native-abi-probe.mjs";

describe("nativeBindingNeedsRebuild", () => {
  it("opens the database so lazy native ABI failures are detected", () => {
    const open = vi.fn();
    const loadDatabase = vi.fn(() =>
      class Database {
        constructor(filename) {
          open(filename);
          throw new Error(
            "The module was compiled against a different Node.js version using NODE_MODULE_VERSION 130",
          );
        }
      },
    );

    expect(nativeBindingNeedsRebuild(loadDatabase)).toBe(true);
    expect(loadDatabase).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(":memory:");
  });

  it("closes a successfully opened probe database", () => {
    const close = vi.fn();
    class Database {
      close = close;
    }

    expect(nativeBindingNeedsRebuild(() => Database)).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not hide unrelated loading errors", () => {
    const error = new Error("package is missing");
    expect(() =>
      nativeBindingNeedsRebuild(() => {
        throw error;
      }),
    ).toThrow(error);
  });

  it("does not hide unrelated database open errors", () => {
    const error = new Error("database initialization failed");
    class Database {
      constructor() {
        throw error;
      }
    }

    expect(() => nativeBindingNeedsRebuild(() => Database)).toThrow(error);
  });

  it("does not hide unrelated database close errors", () => {
    const error = new Error("database close failed");
    class Database {
      close() {
        throw error;
      }
    }

    expect(() => nativeBindingNeedsRebuild(() => Database)).toThrow(error);
  });
});
