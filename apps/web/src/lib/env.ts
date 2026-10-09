/**
 * Configuração de ambiente do frontend.
 *
 * Só variáveis prefixadas com `VITE_` são embutidas no bundle. Nunca coloque
 * segredos aqui — este arquivo vira JavaScript público.
 */

/** URL base do backend de sinalização. */
const rawServerUrl = import.meta.env.VITE_SERVER_URL as string | undefined;

/**
 * Em desenvolvimento o Vite roda na porta 5173 e o servidor em 3001. Em
 * produção a URL vem de `VITE_SERVER_URL` definida no build do Cloudflare
 * Pages.
 */
export const SERVER_URL =
  rawServerUrl && rawServerUrl.trim().length > 0
    ? rawServerUrl.replace(/\/+$/, "")
    : "http://localhost:3001";

export const IS_PROD = import.meta.env.PROD;
