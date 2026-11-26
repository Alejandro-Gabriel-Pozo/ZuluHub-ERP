import type { Kysely, Selectable } from "kysely";
import {
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../../primitivas/identificadores/marca";
import type { CuentaDeImagenDeclarada } from "../dominio/cuenta-de-imagen";
import type { CatalogoDb } from "./esquema";
import { FORMA_DE_UUID } from "./filas";

export type AltaDeCuentaDeImagen = Readonly<{
  proveedor: "CLOUDINARY";
  cuenta: string;
  claveDeIdempotencia: string;
  huella: string;
  declaradaPor: PersonaId;
}>;

/** Lo que se guarda para reconocer un reintento: la huella de lo pedido y la cuenta a la que dio lugar la clave. */
export type AltaYaGuardada = Readonly<{ huella: string; cuenta: CuentaDeImagenDeclarada }>;

/**
 * Las cuentas de imagen que la empresa declaró (0102). Todo filtra por empresa y corre en la transacción de quien llama (que es quien autoriza y audita). El tope de 2
 * activas y la cuenta activa única los impone la base; `insertar` devuelve `null` si chocó una unicidad (la misma clave u otra activa igual) y deja que quien llama
 * mire cuál fue. El tope sale como la restricción `cuenta_de_imagen_tope`, que traduce el caso de uso.
 */
export interface RepositorioDeCuentasDeImagen {
  /** Las ACTIVAS, de la más vieja a la más nueva. */
  activas(empresa: EmpresaId): Promise<readonly CuentaDeImagenDeclarada[]>;
  porClave(empresa: EmpresaId, clave: string): Promise<AltaYaGuardada | null>;
  activaDe(
    empresa: EmpresaId,
    proveedor: "CLOUDINARY",
    cuenta: string,
  ): Promise<CuentaDeImagenDeclarada | null>;
  /** Toma la fila (`FOR UPDATE`): dos retiros a la vez se ponen en fila. */
  bloquear(empresa: EmpresaId, id: string): Promise<CuentaDeImagenDeclarada | null>;
  insertar(empresa: EmpresaId, alta: AltaDeCuentaDeImagen): Promise<CuentaDeImagenDeclarada | null>;
  /** `null` si la versión ya no es la esperada, la cuenta ya estaba retirada o no es de la empresa. */
  retirar(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    retiradaPor: PersonaId,
    motivo: string,
  ): Promise<CuentaDeImagenDeclarada | null>;
}

type Fila = Selectable<CatalogoDb["cuenta_de_imagen_declarada"]>;

/** Lo que la base guarda y el dominio no conoce es una falla, no un dato: nunca se sirve a ciegas. */
function aCuenta(f: Fila): CuentaDeImagenDeclarada {
  if (f.proveedor !== "CLOUDINARY")
    throw new RangeError(`proveedor inválido en la base: ${f.proveedor}`);
  if (f.estado !== "ACTIVA" && f.estado !== "RETIRADA")
    throw new RangeError(`estado inválido en la base: ${f.estado}`);
  return {
    id: f.id,
    proveedor: f.proveedor,
    cuenta: f.cuenta,
    estado: f.estado,
    declaradaPor: personaId(f.declarada_por),
    declaradaEn: f.declarada_en,
    retiradaPor: f.retirada_por === null ? null : personaId(f.retirada_por),
    retiradaEn: f.retirada_en,
    motivoDeRetiro: f.motivo_de_retiro,
    version: f.version,
  };
}

export function crearRepositorioDeCuentasDeImagen(
  db: Kysely<CatalogoDb>,
): RepositorioDeCuentasDeImagen {
  return {
    async activas(empresa) {
      const filas = await db
        .selectFrom("cuenta_de_imagen_declarada")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("estado", "=", "ACTIVA")
        .orderBy("declarada_en")
        .orderBy("id")
        .execute();
      return filas.map(aCuenta);
    },
    async porClave(empresa, clave) {
      const fila = await db
        .selectFrom("cuenta_de_imagen_declarada")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("clave_idempotencia", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : { huella: fila.huella, cuenta: aCuenta(fila) };
    },
    async activaDe(empresa, proveedor, cuenta) {
      const fila = await db
        .selectFrom("cuenta_de_imagen_declarada")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("proveedor", "=", proveedor)
        .where("cuenta", "=", cuenta)
        .where("estado", "=", "ACTIVA")
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },
    async bloquear(empresa, id) {
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .selectFrom("cuenta_de_imagen_declarada")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },
    async insertar(empresa, alta) {
      // `ON CONFLICT DO NOTHING` sin objetivo cubre las dos unicidades (la clave y la cuenta activa): si no insertó, quien llama mira cuál fue. El tope (disparador) no es
      // un conflicto: sale como su restricción.
      const fila = await db
        .insertInto("cuenta_de_imagen_declarada")
        .values({
          empresa_id: empresa,
          proveedor: alta.proveedor,
          cuenta: alta.cuenta,
          clave_idempotencia: alta.claveDeIdempotencia,
          huella: alta.huella,
          declarada_por: alta.declaradaPor,
        })
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },
    async retirar(empresa, id, versionEsperada, retiradaPor, motivo) {
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .updateTable("cuenta_de_imagen_declarada")
        .set({ estado: "RETIRADA", retirada_por: retiradaPor, motivo_de_retiro: motivo })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .where("estado", "=", "ACTIVA")
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },
  };
}
