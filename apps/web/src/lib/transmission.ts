/**
 * Preferências de transmissão escolhidas pelo usuário: FPS e qualidade.
 *
 * - **FPS** vira restrição de `frameRate` no `getDisplayMedia` (captura).
 * - **Qualidade** define a altura ideal da captura E um teto de bitrate,
 *   aplicado nos `RTCRtpSender` via `setParameters()` (transmissão).
 *
 * A captura só aceita restrições no início do compartilhamento — por isso as
 * escolhas valem para o próximo "Compartilhar minha tela". O teto de bitrate,
 * por outro lado, pode ser alterado a qualquer momento.
 */

export type QualityId = "auto" | "high" | "balanced" | "light";

export interface TransmissionPrefs {
  /** Quadros por segundo desejados na captura. */
  fps: number;
  /** Preset de qualidade (resolução + teto de bitrate). */
  quality: QualityId;
}

/** Opções de FPS oferecidas na interface. */
export const FPS_OPTIONS = [15, 24, 30, 60] as const;

export interface QualityOption {
  id: QualityId;
  /** Rótulo amigável na interface. */
  label: string;
  /** Altura ideal da captura em pixels; `null` deixa o navegador decidir. */
  heightIdeal: number | null;
  /** Teto de bitrate de vídeo em kbps; `null` não aplica limite. */
  bitrateKbps: number | null;
}

/** Preset "Automática" — referência para fallbacks (padrão do produto). */
const AUTO_QUALITY: QualityOption = {
  id: "auto",
  label: "Automática",
  heightIdeal: null,
  bitrateKbps: null,
};

/** Presets de qualidade. O padrão é "Automática" (comportamento atual). */
export const QUALITY_OPTIONS: QualityOption[] = [
  AUTO_QUALITY,
  { id: "high", label: "Alta (1080p)", heightIdeal: 1080, bitrateKbps: 4000 },
  { id: "balanced", label: "Equilibrada (720p)", heightIdeal: 720, bitrateKbps: 1500 },
  { id: "light", label: "Leve (540p)", heightIdeal: 540, bitrateKbps: 700 },
];

export const DEFAULT_PREFS: TransmissionPrefs = { fps: 30, quality: "auto" };

/** Retorna o preset de qualidade com validação defensiva do id. */
export function qualityOption(id: QualityId): QualityOption {
  return QUALITY_OPTIONS.find((option) => option.id === id) ?? AUTO_QUALITY;
}

/**
 * Restrições de vídeo para `getDisplayMedia` com base nas preferências.
 * `height`/`width` são pedidos ideais (o navegador pode flexibilizar);
 * `frameRate` com `max` trava o teto de quadros.
 */
export function videoConstraintsFor(prefs: TransmissionPrefs): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {
    frameRate: { ideal: prefs.fps, max: prefs.fps },
  };

  const heightIdeal = qualityOption(prefs.quality).heightIdeal;
  if (heightIdeal) {
    constraints.height = { ideal: heightIdeal };
    // Proporção 16:9 de referência — a captura real segue o conteúdo.
    constraints.width = { ideal: Math.round((heightIdeal * 16) / 9) };
  }

  return constraints;
}

const STORAGE_KEY = "telaviva:transmission";

/** Lê as preferências salvas, validando cada campo contra as opções. */
export function loadTransmissionPrefs(): TransmissionPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;

    const parsed = JSON.parse(raw) as Partial<TransmissionPrefs>;
    const fps = FPS_OPTIONS.find((value) => value === parsed.fps);
    const quality = QUALITY_OPTIONS.some((option) => option.id === parsed.quality)
      ? parsed.quality
      : DEFAULT_PREFS.quality;

    return {
      fps: fps ?? DEFAULT_PREFS.fps,
      quality: quality as QualityId,
    };
  } catch {
    // localStorage indisponível ou valor corrompido: usa o padrão.
    return DEFAULT_PREFS;
  }
}

/** Persiste as preferências; falhas de armazenamento são silenciosas. */
export function saveTransmissionPrefs(prefs: TransmissionPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Modo privado/quota cheia — a escolha vale só nesta sessão.
  }
}
