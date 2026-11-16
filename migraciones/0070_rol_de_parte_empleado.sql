-- 0070_rol_de_parte_empleado: siembra el rol EMPLEADO en el vocabulario `rol_de_parte` (LB-6), para que una persona del personal pueda ser PARTE
-- de la empresa y tener saldo en el libro (el anticipo a rendir es el quinto uso de `primitiva-de-libro-diseno.md` §3.4.1). Es una fila: 0034 ya
-- lo anticipaba («EMPLEADO entra con un INSERT en una extensión, sin tocar `parte_rol`»).
-- Previene: que el personal se cargue como CUSTOMER o PROVEEDOR para poder tener saldo (un empleado mezclado con clientes y proveedores en sus listas y reportes).
-- Probado por `test/integracion/clientes-rol-empleado-migracion.test.ts`.
--
-- Reglas de esta migración (las mismas de 0034 y 0058):
--  * ADITIVA y compatible hacia atrás: agrega UNA fila a un vocabulario global. No crea, cambia ni borra ninguna tabla, columna, restricción, función,
--    disparador, política ni permiso; no toca ningún dato de ninguna empresa. El código anterior no conoce el rol y no lo pide: sigue andando igual.
--  * `rol_de_parte` es de solo inserción (disparador `rol_de_parte_solo_insercion`: bloquea UPDATE y DELETE, también al dueño): INSERTAR es lo único permitido y es
--    lo que se hace acá. La aplicación sigue con SOLO SELECT sobre el vocabulario (nadie le da INSERT).
--  * El código `EMPLEADO` y la descripción pasan las mismas restricciones de la tabla (`rol_de_parte_codigo_ck`, `rol_de_parte_descripcion_ck`).
--  * Un rol repetido lo rechaza la clave primaria (`rol_de_parte_pkey`); la migración además se frena con un error claro si el rol ya está.
--  * El empleado NO entra al sistema por esto: es solo una parte con ficha (no crea usuarios, permisos ni accesos).
--  * Su reversión es `migraciones/reversiones/0070_revertir_rol_de_parte_empleado.sql` (se frena si alguna parte ya tiene ese rol).
-- DEPENDE de 0034 (`rol_de_parte` con sus dos roles); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.rol_de_parte') IS NULL THEN
    RAISE EXCEPTION '0070 necesita 0034 (rol_de_parte)' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM public.rol_de_parte WHERE codigo IN ('CUSTOMER', 'PROVEEDOR')) <> 2 THEN
    RAISE EXCEPTION '0070 necesita los roles CUSTOMER y PROVEEDOR sembrados por 0034' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rol_de_parte WHERE codigo = 'EMPLEADO') THEN
    RAISE EXCEPTION '0070: el rol EMPLEADO ya existe; esta migración solo lo siembra' USING ERRCODE = '55000';
  END IF;
END
$$;

INSERT INTO rol_de_parte (codigo, descripcion) VALUES
  ('EMPLEADO', 'Persona que trabaja para el negocio');
