import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import type * as Scope from "effect/Scope"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Plugin } from "@/plugin"
import { MessageID, SessionID } from "@/session/schema"
import { ShellTool } from "@/tool/shell"
import { Truncate } from "@/tool/truncate"
import type { Tool } from "@/tool/tool"
import { InstanceStore } from "@/project/instance-store"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const layer = Layer.mergeAll(
  CrossSpawnSpawner.defaultLayer,
  FSUtil.defaultLayer,
  Plugin.defaultLayer,
  Truncate.defaultLayer,
  Config.defaultLayer,
  Agent.defaultLayer,
  RuntimeFlags.defaultLayer,
  testInstanceStoreLayer,
)
const it = testEffect(layer)
type Services =
  | (typeof layer extends Layer.Layer<infer ROut, infer _E, infer _RIn> ? ROut : never)
  | InstanceStore.Service
  | Scope.Scope

const ctx = {
  sessionID: SessionID.make("ses_shell_env"),
  messageID: MessageID.make("msg_shell_env"),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const run = Effect.fn("ShellEnvTest.run")(function* (args: Tool.InferParameters<typeof ShellTool>) {
  const info = yield* ShellTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

it.effect("does not expose backend credentials to model shell commands", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const values = {
        password: process.env.KILO_SERVER_PASSWORD,
        username: process.env.KILO_SERVER_USERNAME,
      }
      process.env.KILO_SERVER_PASSWORD = "secret"
      process.env.KILO_SERVER_USERNAME = "kilo"
      return values
    }),
    () =>
      tmpdirScoped().pipe(
        Effect.flatMap((tmp) =>
          provideInstance(tmp)(
            run({
              command:
                process.platform === "win32"
                  ? "if defined KILO_SERVER_PASSWORD (echo set) else (echo unset)"
                  : 'test -z "$KILO_SERVER_PASSWORD" && printf unset',
              description: "Check backend credential isolation",
            }),
          ),
        ),
        Effect.map((result) => expect(result.output.trim()).toBe("unset")),
      ) as Effect.Effect<void, never, Services>,
    (values) =>
      Effect.sync(() => {
        if (values.password === undefined) delete process.env.KILO_SERVER_PASSWORD
        else process.env.KILO_SERVER_PASSWORD = values.password
        if (values.username === undefined) delete process.env.KILO_SERVER_USERNAME
        else process.env.KILO_SERVER_USERNAME = values.username
      }),
  ),
)
