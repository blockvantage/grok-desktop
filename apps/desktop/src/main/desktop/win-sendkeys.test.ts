import { describe, it, expect } from "vitest";
import {
  escapePowerShellSingleQuoted,
  escapeSendKeysText,
} from "./win-adapter";

describe("Windows SendKeys escaping", () => {
  it("braces SendKeys special characters for literal typing", () => {
    expect(escapeSendKeysText("hello")).toBe("hello");
    expect(escapeSendKeysText("a+b")).toBe("a{+}b");
    expect(escapeSendKeysText("^c")).toBe("{^}c");
    expect(escapeSendKeysText("%{F4}")).toBe("{%}{{}F4{}}");
    expect(escapeSendKeysText("100%")).toBe("100{%}");
    expect(escapeSendKeysText("a(b)c")).toBe("a{(}b{)}c");
    expect(escapeSendKeysText("x~y")).toBe("x{~}y");
    expect(escapeSendKeysText("[ok]")).toBe("{[}ok{]}");
  });

  it("doubles single quotes for PowerShell single-quoted strings", () => {
    expect(escapePowerShellSingleQuoted("it's")).toBe("it''s");
    expect(escapePowerShellSingleQuoted("plain")).toBe("plain");
  });

  it("combined escape keeps password-like and chord-like text safe", () => {
    const raw = "P@ss+word'%{F4}";
    const forSendKeys = escapeSendKeysText(raw);
    expect(forSendKeys).toBe("P@ss{+}word'{%}{{}F4{}}");
    expect(escapePowerShellSingleQuoted(forSendKeys)).toBe(
      "P@ss{+}word''{%}{{}F4{}}",
    );
  });

  it("PowerShell single-quote escape neutralizes cmd-style metacharacters in paths", () => {
    // Start-Process -LiteralPath '…' must not break out of the quoted string.
    const evil = "C:\\good.exe' ; Start-Process calc ; '";
    expect(escapePowerShellSingleQuoted(evil)).toBe(
      "C:\\good.exe'' ; Start-Process calc ; ''",
    );
  });
});
