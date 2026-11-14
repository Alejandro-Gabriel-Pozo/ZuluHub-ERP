-- 0052_tope_de_partes_de_la_division: dividir la cuenta admite hasta 12 partes en la base (antes 4).
-- Decisión del dueño (14/11/2026, `11-especificaciones/decisiones-del-dueno-2026-11.md` del repo de docs): como máximo 10 cuentas al dividir por ÍTEMS y 12 partes por
-- PORCENTAJE (antes 4 y 6, salidos de maquetas). Los dos límites viven en `src/primitivas/cuentas/limites-de-division.ts`; la base solo copia el MAYOR (12) y
-- `test/integracion/salon-division-limites.test.ts` falla si este número y esa constante difieren. El 10 por ítems lo exige el servidor antes de escribir.
--
-- Qué cambia: los dos CHECK de 0038 que fijaban el 4:
--  * `division_de_cuenta.division_partes_ck`:        partes BETWEEN 2 AND 4  →  BETWEEN 2 AND 12
--  * `parte_de_division.parte_de_division_numero_ck`: numero BETWEEN 1 AND 4 →  BETWEEN 1 AND 12
-- (sin ellos ampliados, el servidor aceptaría 5 cuentas y la base rechazaría la 5.ª a mitad de la transacción). El disparador `division_partes_cuadran` no tiene tope propio:
-- compara con las partes declaradas, así que no cambia. Las cuentas hijas (`cuenta_consumo`, con el departamento de 0048) no tienen tope de cantidad.
--
-- Reglas de esta migración: ADITIVA y compatible hacia atrás: solo AMPLÍA un rango, así toda fila que existe (2 a 4 partes) sigue cumpliendo y nada se reescribe;
-- el código anterior (que no pasa de 4) sigue funcionando. No toca datos, privilegios ni disparadores. Es idempotente en el nombre de las restricciones: las vuelve a
-- crear con el mismo nombre. Su reversión es un script aparte, revisado: `migraciones/reversiones/0052_revertir_tope_de_partes_de_la_division.sql` (NO destructiva; se
-- FRENA si hay divisiones con más de 4 partes, porque el rango viejo las dejaría inválidas).
-- DEPENDE de 0038 (salón); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.division_de_cuenta') IS NULL OR to_regclass('public.parte_de_division') IS NULL THEN
    RAISE EXCEPTION 'el tope de partes de la división requiere 0038_salon aplicada antes' USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE division_de_cuenta DROP CONSTRAINT division_partes_ck;
ALTER TABLE division_de_cuenta ADD CONSTRAINT division_partes_ck CHECK (partes BETWEEN 2 AND 12);

ALTER TABLE parte_de_division DROP CONSTRAINT parte_de_division_numero_ck;
ALTER TABLE parte_de_division ADD CONSTRAINT parte_de_division_numero_ck CHECK (numero BETWEEN 1 AND 12);
