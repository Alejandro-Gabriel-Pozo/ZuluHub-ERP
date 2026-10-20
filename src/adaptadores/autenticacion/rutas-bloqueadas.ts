/**
 * Rutas de Better Auth 1.7.7 que esta aplicación NO usa, para `disabledPaths` (web-armazon §4.1). Es un
 * cinturón sobre el tirante: lo que de verdad cierra el paso es la lista cerrada `RUTAS_PERMITIDAS`
 * (`disabledPaths` compara el texto literal y no entiende `:token` ni `:id`, y las llamadas internas a
 * `auth.api` no pasan por ella). Una prueba compara esta lista con las rutas que declara la librería:
 * si una versión nueva suma una, falla y hay que mirarla.
 */
export const RUTAS_BLOQUEADAS: readonly string[] = [
  "/sign-up/email",
  "/sign-in/email",
  "/reset-password",
  "/verify-password",
  "/verify-email",
  "/send-verification-email",
  "/change-email",
  "/change-password",
  "/update-session",
  "/update-user",
  "/delete-user",
  "/request-password-reset",
  "/reset-password/:token",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/link-social",
  "/list-accounts",
  "/delete-user/callback",
  "/unlink-account",
  "/refresh-token",
  "/get-access-token",
  "/account-info",
  "/ok",
  "/error",
];

/**
 * Las rutas del plugin `twoFactor` que la consola NO usa (h5-p8 §3): ver el secreto, dar de baja el TOTP y el
 * código por mail o SMS (que ni está configurado). Se suman a las de empresa. Las que sí se usan (enrolar, verificar
 * el código de la aplicación, verificar uno de recuperación y regenerar los códigos) están en
 * `RUTAS_PERMITIDAS_DE_PLATAFORMA`. Igual que arriba, el cierre real es esa lista cerrada; una prueba compara esta con
 * lo que declara la librería.
 */
export const RUTAS_BLOQUEADAS_DE_PLATAFORMA: readonly string[] = [
  ...RUTAS_BLOQUEADAS,
  "/two-factor/get-totp-uri",
  "/two-factor/disable",
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
];
