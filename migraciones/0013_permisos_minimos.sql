-- 0013_permisos_minimos: cierra dos hallazgos de la revisión de seguridad, los dos SOLO de permisos (quitar de más y
-- dar lo mínimo):
--
--  1. La aplicación (`zuluhub_app`) no podía leer la tabla de control `migracion` (la que lleva el ejecutor con las
--     migraciones aplicadas), y la guarda de la web (`MIGRACION_REQUERIDA`, «En mantenimiento») necesita saber cuál
--     es la última. La lectura es `SELECT nombre FROM migracion ORDER BY nombre DESC LIMIT 1`: se le concede
--     `SELECT` sobre UNA columna, `nombre`. No `checksum` (el hash de cada archivo: no se usa y no es de la web) ni
--     `aplicada_en`, y ni una escritura. Ningún otro rol cambia.
--  2. La librería de autenticación (`zuluhub_autenticacion`) tenía `DELETE` sobre las CINCO tablas de su esquema
--     (0010). Sobre `autenticacion."user"` y `autenticacion.account` no hace falta: las rutas `/delete-user`,
--     `/delete-user/callback` y `/unlink-account` están cerradas (`rutas-bloqueadas.ts`, sin plugins de
--     administración ni anónimos) y borrar un usuario arrastra en cascada sus sesiones y cuentas. Se le quita ahí.
--     Conserva `DELETE` donde sí se usa: `session` (cierre de sesión, rotación, sesión vencida y el barrido),
--     `verification` y `"rateLimit"` (el barrido de vencidos).
--
-- El número 0013 lo asigna el orden de integración (0010 a 0012 ya están en `main`).
--
-- Reglas de esta migración (las mismas de 0001 a 0012):
--  * Es ADITIVA en el sentido que importa: solo cambian PRIVILEGIOS (una concesión por columna y un retiro de
--    `DELETE`). No crea ni borra tablas, columnas, políticas, funciones ni filas, y no toca ningún dato. Su
--    reversión es un script aparte, revisado, que NO pierde datos y devuelve los privilegios de antes:
--    `migraciones/reversiones/0013_revertir_permisos_minimos.sql`. El ejecutor no lo aplica.
--  * Es REPETIBLE: cada sentencia es una concesión o un retiro, que repetidos no cambian nada, y las guardas solo
--    leen el catálogo. Corre dentro de la transacción del ejecutor, que ya serializa con el bloqueo asesor.
--  * `migracion` NO tiene RLS (no es dato de una empresa: es el registro del esquema, y lo que se lee de ella, el
--    nombre de cada archivo, no lo es tampoco). Lo único que la acota es el permiso por columna de acá.
--  * Las políticas `rol_autenticacion_borrar` de `user` y `account` (0010) se dejan como están: sin el privilegio
--    de tabla no se llega a ellas, y no hace falta tocar lo que no es un permiso.
--  * No crea roles ni da LOGIN ni contraseñas. Sin claves ni cadenas de conexión en este archivo.
--
-- Decisión de diseño (probada por tests):
--
--  P1. Primero se retira todo privilegio de TABLA de `zuluhub_app` sobre `migracion` y después se concede la
--      columna. Hoy no tiene ninguno (ninguna migración se lo da), así que el retiro no cambia nada; sirve para que
--      el resultado sea EXACTAMENTE `SELECT (nombre)` aunque alguien le haya concedido de más a mano en una base
--      (un `GRANT SELECT ON migracion` de urgencia dejaría leer el `checksum` y el retiro lo corrige).

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NULL THEN
    RAISE EXCEPTION '0013 se corre con el ejecutor de migraciones, que crea la tabla de control `migracion` antes de aplicar nada'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('autenticacion."user"') IS NULL
     OR to_regclass('autenticacion.account') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zuluhub_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zuluhub_autenticacion') THEN
    RAISE EXCEPTION '0013 requiere 0010_autenticacion aplicada antes (falta el esquema de la librería o alguno de sus roles)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- 1. La guarda de migración de la web: solo el nombre de cada migración aplicada.
REVOKE ALL ON migracion FROM zuluhub_app;
GRANT SELECT (nombre) ON migracion TO zuluhub_app;

-- 2. La librería de autenticación ya no borra usuarios ni cuentas.
REVOKE DELETE ON autenticacion."user", autenticacion.account FROM zuluhub_autenticacion;
