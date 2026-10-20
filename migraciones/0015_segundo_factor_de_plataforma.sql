-- 0015_segundo_factor_de_plataforma: lo que necesita el segundo factor de la consola de plataforma (P8a): el plugin
-- `twoFactor` de Better Auth 1.7.7 (la tabla del secreto TOTP cifrado y de los códigos de recuperación, y la bandera en el
-- usuario), la marca «segundo factor verificado» de la sesión (G1) y los dos registros propios que cierran G2 (un código
-- TOTP ya usado no se acepta de nuevo) y el límite de intentos. Especificación h5-p8 §2.4 y §2.6; ADR-013 (G1 a G3).
--
-- El SQL de la librería lo exportó la propia librería (`getMigrations(...).compileMigrations()` con las opciones de la
-- audiencia de plataforma, contra una base con 0001 a 0014) y se REVISÓ línea por línea. Lo que cambia respecto de lo que
-- exporta, y por qué:
--   * se quitó `create schema if not exists "autenticacion"` (el esquema ya existe desde 0010, y el rol que corre esto
--     no debe poder crear esquemas);
--   * se agregó `NOT NULL DEFAULT false` a `"twoFactorEnabled"` y a `"twoFactor".verified`: la librería los deja
--     anulables y trata el `NULL` de forma distinta según la ruta (en una cuenta con `verified` nulo, `enable` diría «ya
--     está activo» y `verify-totp` «sin verificar»). Un estado dudoso es «no verificado»;
--   * el índice de `"twoFactor"."userId"` es ÚNICO: una persona tiene una sola fila de segundo factor. La librería lo
--     deja sin unicidad, y dos pedidos de enrolar a la vez podían dejar dos secretos para el mismo usuario;
--   * `"twoFactor_secret_idx"` se conserva tal cual lo pide la librería (`getMigrations` lo busca por nombre): indexa el
--     texto CIFRADO del secreto, que no se consulta nunca, pero no agrega nada que ya no esté en la tabla.
--
-- Reglas de esta migración (las mismas de 0001 a 0014):
--  * Es ADITIVA: dos columnas, tres tablas, sus índices, privilegios y políticas. No modifica ni borra ninguna fila,
--    política ni privilegio existente (no toca `user`, `session` ni `account` salvo por las columnas nuevas, que nacen
--    con valor por defecto constante o nulas: no reescriben la tabla). La web de empresa no usa nada de esto y sigue
--    igual: su instancia de la librería no declara esas columnas. Su reversión es un script aparte, revisado y
--    DESTRUCTIVA (borra los secretos TOTP y los códigos de recuperación: cada administrador tendría que volver a
--    enrolarse): `migraciones/reversiones/0015_revertir_segundo_factor_de_plataforma.sql`. El ejecutor no lo aplica.
--  * Es REPETIBLE: `IF NOT EXISTS` y concesiones, que repetidas no cambian nada; las políticas se crean solo si faltan.
--    Corre dentro de la transacción del ejecutor, que ya serializa con el bloqueo asesor.
--  * No agrega NINGUNA función SECURITY DEFINER ni función alguna. Sin LOGIN ni contraseñas ni cadenas de conexión.
--  * RLS activa y FORZADA en toda tabla nueva, con una política por comando y solo para `pedernal_autenticacion` (como 0010).
--  * DEPENDE de 0010 (el esquema `autenticacion`, `user` y `session`) y de 0013 (que quitó el `DELETE` sobre `user`);
--    se comprueba al empezar.
--
-- Decisiones de diseño (todas probadas por tests):
--
--  P1. Secretos. `"twoFactor".secret` es el secreto TOTP CIFRADO por la librería (XChaCha20-Poly1305 con el secreto de la
--      audiencia). `"twoFactor"."backupCodes"` guarda la lista de HUELLAS (HMAC-SHA256) de los códigos de recuperación,
--      nunca los códigos (`capacidades/autenticacion/codigos-de-recuperacion.ts`). `codigo_totp_usado` guarda el NÚMERO
--      DE PASO del reloj, nunca el código. Una prueba busca el secreto, la dirección `otpauth` y los códigos en claro en
--      todas las tablas: no aparecen.
--  P2. Privilegios mínimos de `pedernal_autenticacion`. `"twoFactor"`: SELECT, INSERT y UPDATE de SOLO tres columnas
--      (secreto, códigos y `verified`: lo que escriben enrolar, verificar el primer código y gastar un código de
--      recuperación). NADA de DELETE: no hay ruta que dé de baja el TOTP (la baja y el reseteo los hace el dueño con su
--      conexión, y el borrado de un usuario arrastra su fila). `codigo_totp_usado` e `intento_segundo_factor`: SELECT,
--      INSERT y DELETE (cada intento limpia lo viejo del usuario), sin UPDATE. Sobre `"user"` y `account` sigue sin
--      DELETE, como dejó 0013.
--  P3. `session.segundo_factor_en` (G1). Nace NULO: una sesión de Google no tiene segundo factor. Lo fija el gancho que corre
--      después de verificar un código; la librería no lo acepta desde el cliente (`input: false`). El servidor no arma
--      el contexto de plataforma sin él (P8b).
--  P4. G2. `codigo_totp_usado` tiene clave primaria (usuario, paso): con 8 pedidos simultáneos del mismo código, la base
--      deja pasar a UNO (`INSERT ... ON CONFLICT DO NOTHING`). La clave completa (no parcial) alcanza y es más fuerte:
--      la tabla solo tiene códigos usados, no hay filas que excluir.
--  P5. Límite de intentos. `intento_segundo_factor` guarda cuándo falló cada intento; la decisión (5 en 10 minutos bloquean
--      15) es la función pura `decisionDeBloqueo`. Los intentos de un usuario se serializan con un candado consultivo de
--      transacción, así que pedir en paralelo no esquiva el límite.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pedernal_autenticacion') THEN
    RAISE EXCEPTION 'el segundo factor requiere 0004_plataforma y 0010_autenticacion aplicadas antes (falta el rol pedernal_autenticacion)'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('autenticacion."user"') IS NULL OR to_regclass('autenticacion.session') IS NULL THEN
    RAISE EXCEPTION 'el segundo factor requiere 0010_autenticacion aplicada antes (falta el esquema de la librería)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Lo que exporta la librería (twoFactor 1.7.7), revisado
-- ---------------------------------------------------------------------------------------------
ALTER TABLE autenticacion."user" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" boolean NOT NULL DEFAULT false;

-- G1 (P3): `fieldName` de la columna propia que declara la audiencia de plataforma.
ALTER TABLE autenticacion.session ADD COLUMN IF NOT EXISTS segundo_factor_en timestamptz;

CREATE TABLE IF NOT EXISTS autenticacion."twoFactor" (
  id                        uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  secret                    text NOT NULL,
  "backupCodes"             text NOT NULL,
  "userId"                  uuid NOT NULL REFERENCES autenticacion."user" (id) ON DELETE CASCADE,
  verified                  boolean NOT NULL DEFAULT false,
  "failedVerificationCount" integer,
  "lockedUntil"             timestamptz
);
CREATE INDEX IF NOT EXISTS "twoFactor_secret_idx" ON autenticacion."twoFactor" (secret);
CREATE UNIQUE INDEX IF NOT EXISTS "twoFactor_userId_idx" ON autenticacion."twoFactor" ("userId");

-- ---------------------------------------------------------------------------------------------
-- Lo propio (P4 y P5)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS autenticacion.codigo_totp_usado (
  usuario_id uuid NOT NULL REFERENCES autenticacion."user" (id) ON DELETE CASCADE,
  paso       bigint NOT NULL CONSTRAINT codigo_totp_usado_paso_ck CHECK (paso >= 0),
  usado_en   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT codigo_totp_usado_pk PRIMARY KEY (usuario_id, paso)
);

CREATE TABLE IF NOT EXISTS autenticacion.intento_segundo_factor (
  id         uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES autenticacion."user" (id) ON DELETE CASCADE,
  fallo_en   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS intento_segundo_factor_usuario_ix
  ON autenticacion.intento_segundo_factor (usuario_id, fallo_en);

-- ---------------------------------------------------------------------------------------------
-- Privilegios (P2). Nadie más que `pedernal_autenticacion` toca estas tablas, salvo el rol de respaldo (0012), que recibe
-- SELECT por los privilegios por defecto del rol que migra, como en toda tabla nueva (es de solo lectura y el único que salta la RLS).
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON autenticacion."twoFactor", autenticacion.codigo_totp_usado, autenticacion.intento_segundo_factor
  FROM PUBLIC;

GRANT SELECT, INSERT ON autenticacion."twoFactor" TO pedernal_autenticacion;
GRANT UPDATE (secret, "backupCodes", verified) ON autenticacion."twoFactor" TO pedernal_autenticacion;
GRANT SELECT, INSERT, DELETE ON autenticacion.codigo_totp_usado, autenticacion.intento_segundo_factor
  TO pedernal_autenticacion;

-- RLS forzada, una política por comando concedido y solo para ese rol (como 0010).
DO $$
DECLARE
  t text;
  c text;
  comandos jsonb := jsonb_build_object(
    'twoFactor', ARRAY['SELECT', 'INSERT', 'UPDATE'],
    'codigo_totp_usado', ARRAY['SELECT', 'INSERT', 'DELETE'],
    'intento_segundo_factor', ARRAY['SELECT', 'INSERT', 'DELETE']
  );
  nombres constant jsonb := jsonb_build_object(
    'SELECT', 'rol_autenticacion_leer', 'INSERT', 'rol_autenticacion_alta',
    'UPDATE', 'rol_autenticacion_cambiar', 'DELETE', 'rol_autenticacion_borrar'
  );
BEGIN
  FOR t IN SELECT jsonb_object_keys(comandos)
  LOOP
    EXECUTE format('ALTER TABLE autenticacion.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE autenticacion.%I FORCE ROW LEVEL SECURITY', t);
    FOR c IN SELECT jsonb_array_elements_text(comandos -> t)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'autenticacion' AND tablename = t AND policyname = nombres ->> c
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON autenticacion.%I FOR %s TO pedernal_autenticacion %s',
          nombres ->> c, t, c,
          CASE c
            WHEN 'INSERT' THEN 'WITH CHECK (true)'
            WHEN 'UPDATE' THEN 'USING (true) WITH CHECK (true)'
            ELSE 'USING (true)'
          END
        );
      END IF;
    END LOOP;
  END LOOP;
END
$$;
