import { useCallback, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ROOM_CODE_LENGTH, formatRoomCode } from "@tela/shared";
import { Brand } from "../components/Brand";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { useRoom } from "../state/RoomContext";

/**
 * Página inicial.
 *
 * Concentra as duas ações principais — criar sala e entrar com código — e
 * explica o serviço em poucas palavras. Sem cadastro, sem menu poluído.
 */
export function HomePage() {
  const navigate = useNavigate();
  const { createRoom, joinRoom } = useRoom();

  // Formulário de criação.
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [creating, setCreating] = useState(false);

  // Formulário de entrada.
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setError(null);
      setCreating(true);
      try {
        const data = await createRoom({
          name: name.trim() || undefined,
          password: usePassword ? password : undefined,
        });
        navigate(`/r/${data.roomCode}`);
      } catch {
        setError("Não foi possível criar a sala. Tente novamente.");
      } finally {
        setCreating(false);
      }
    },
    [createRoom, name, navigate, password, usePassword],
  );

  const handleJoin = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setError(null);

      const normalized = code.replace(/[\s-]+/g, "").toUpperCase();
      if (normalized.length !== ROOM_CODE_LENGTH) {
        setError(`O código deve ter ${ROOM_CODE_LENGTH} caracteres.`);
        return;
      }

      setJoining(true);
      try {
        await joinRoom({ roomCode: normalized });
        navigate(`/r/${normalized}`);
      } catch (caught) {
        const message =
          caught && typeof caught === "object" && "message" in caught
            ? String((caught as { message: string }).message)
            : "Não foi possível entrar na sala.";
        setError(message);
      } finally {
        setJoining(false);
      }
    },
    [code, joinRoom, navigate],
  );

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Brilho e grade de fundo, puramente decorativos. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] glow-accent" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 grid-bg" aria-hidden="true" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-8">
        <header className="flex items-center justify-between">
          <Brand />
          <span className="rounded-full border border-base-700/70 bg-base-850/60 px-3 py-1 text-xs text-ink-500">
            grátis · sem cadastro
          </span>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center py-14">
          <div className="w-full max-w-2xl text-center">
            <h1 className="text-4xl font-semibold tracking-tight text-ink-100 sm:text-5xl">
              Compartilhe sua tela
              <br />
              <span className="text-accent-400">em segundos.</span>
            </h1>
            <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-ink-500">
              Crie uma sala, mande o link para a galera e pronto. Nada de
              instalar programa, nada de criar conta.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-8 w-full max-w-md rounded-xl border border-danger-500/40 bg-danger-500/10 px-4 py-3 text-sm text-danger-400 animate-fade-in"
            >
              {error}
            </div>
          )}

          <div className="mt-10 grid w-full max-w-3xl gap-5 sm:grid-cols-2">
            {/* Criar sala */}
            <section className="surface flex flex-col p-6">
              <h2 className="text-base font-semibold text-ink-100">Criar uma sala</h2>
              <p className="muted mt-1">
                Você recebe um link para mandar para quem quiser.
              </p>

              <form onSubmit={handleCreate} className="mt-5 flex flex-col gap-4">
                <Field
                  label="Seu nome (opcional)"
                  placeholder="Como quer ser chamado?"
                  value={name}
                  maxLength={24}
                  onChange={(event) => setName(event.target.value)}
                />

                <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-300">
                  <input
                    type="checkbox"
                    checked={usePassword}
                    onChange={(event) => setUsePassword(event.target.checked)}
                    className="size-4 rounded border-base-600 bg-base-900 accent-accent-500"
                  />
                  Proteger com senha
                </label>

                {usePassword && (
                  <Field
                    label="Senha da sala"
                    type="password"
                    placeholder="Mínimo de 4 caracteres"
                    value={password}
                    minLength={4}
                    maxLength={64}
                    onChange={(event) => setPassword(event.target.value)}
                    className="animate-fade-in"
                  />
                )}

                <Button type="submit" loading={creating} className="mt-1 w-full">
                  {creating ? "Criando..." : "Criar sala"}
                </Button>
              </form>
            </section>

            {/* Entrar em sala */}
            <section className="surface flex flex-col p-6">
              <h2 className="text-base font-semibold text-ink-100">Entrar em uma sala</h2>
              <p className="muted mt-1">Já tem um código ou um convite?</p>

              <form onSubmit={handleJoin} className="mt-5 flex flex-col gap-4">
                <Field
                  label="Código da sala"
                  placeholder="Ex.: K7M2QX"
                  value={code}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={ROOM_CODE_LENGTH + 2}
                  onChange={(event) => {
                    const raw = event.target.value.toUpperCase();
                    // Mantém só letras/números e formata enquanto digita.
                    const cleaned = raw.replace(/[^A-Z0-9]/g, "").slice(0, ROOM_CODE_LENGTH);
                    setCode(cleaned);
                  }}
                  hint={
                    code.length > 0 && code.length < ROOM_CODE_LENGTH
                      ? `Faltam ${ROOM_CODE_LENGTH - code.length} caractere(s).`
                      : formatRoomCode(code) || undefined
                  }
                />

                <Field
                  label="Seu nome (opcional)"
                  placeholder="Como quer ser chamado?"
                  value={name}
                  maxLength={24}
                  onChange={(event) => setName(event.target.value)}
                />

                <Button
                  type="submit"
                  variant="secondary"
                  loading={joining}
                  className="mt-1 w-full"
                >
                  {joining ? "Entrando..." : "Entrar na sala"}
                </Button>
              </form>
            </section>
          </div>

          {/* Explicação curta de como funciona. */}
          <div className="mt-14 w-full max-w-3xl">
            <h3 className="text-center text-sm font-medium uppercase tracking-wider text-ink-700">
              Como funciona
            </h3>
            <ol className="mt-5 grid gap-4 sm:grid-cols-3">
              {[
                ["Crie a sala", "Um clique e você tem um código e um link."],
                ["Mande o link", "WhatsApp, Discord, onde for."],
                ["Assistam juntos", "A tela aparece na hora para todo mundo."],
              ].map(([title, description], index) => (
                <li key={title} className="surface p-5">
                  <span className="flex size-7 items-center justify-center rounded-full bg-accent-500/15 text-sm font-semibold text-accent-400">
                    {index + 1}
                  </span>
                  <p className="mt-3 text-sm font-medium text-ink-100">{title}</p>
                  <p className="muted mt-1">{description}</p>
                </li>
              ))}
            </ol>
          </div>
        </main>

        <footer className="mt-auto pt-10 text-center text-xs text-ink-700">
          <p>
            Nada é gravado. A conexão de vídeo acontece direto entre os
            navegadores.
          </p>
        </footer>
      </div>
    </div>
  );
}
