import type { Kysely } from "kysely";
import type { EmpresaId, PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { CartaPublica, EstadoDeCarta } from "../dominio/carta-publica";
import type { CartaPublicaId } from "../dominio/identificadores";
import type { CatalogoDb } from "./esquema";
import { aCartaPublica } from "./filas-de-carta";
import { FORMA_DE_UUID } from "./filas";
import { insertarIdempotente } from "./insertar-idempotente";

const esUuid = (texto: string): boolean => FORMA_DE_UUID.test(texto);

export type AltaDeCartaPublica = Readonly<{
  /** Lo manda la aplicación: es la idempotencia del alta y no cambia nunca. */
  id: CartaPublicaId;
  sucursalId: SucursalId;
  /** Lo generó el puerto de azar; no cambia nunca. */
  codigo: string;
  nombre: string;
  rubro: string | null;
  lugar: string | null;
  mensajeDePortada: string | null;
  estado: EstadoDeCarta;
  creadoPor: PersonaId | null;
}>;

export type CambiosDeCartaPublica = Readonly<{
  nombre: string;
  rubro: string | null;
  lugar: string | null;
  mensajeDePortada: string | null;
  estado: EstadoDeCarta;
}>;

/**
 * Las cartas públicas de la empresa (carta real §3.2): una por sucursal. Todo filtra por empresa y corre en la transacción de quien llama (que es quien
 * autoriza y audita). El código y la sucursal no cambian después del alta: no hay forma de pasarlos a `actualizar` y la base lo impone con un disparador.
 */
export interface RepositorioDeCartas {
  obtener(empresa: EmpresaId, id: string): Promise<CartaPublica | null>;
  /** Como `obtener`, tomando la fila (`FOR UPDATE`): lo que sigue en la transacción no se cruza con otra edición. */
  bloquear(empresa: EmpresaId, id: string): Promise<CartaPublica | null>;
  deLaSucursal(empresa: EmpresaId, sucursal: string): Promise<CartaPublica | null>;
  /**
   * Alta idempotente por `id`. `false` si el `id` ya estaba (una repetición: quien llama compara con lo guardado). Si el choque es contra OTRA restricción
   * (la sucursal ya tiene carta, el código ya existe) la base lanza esa restricción tal cual y la traduce el caso de uso.
   */
  insertar(empresa: EmpresaId, alta: AltaDeCartaPublica): Promise<boolean>;
  /** `null` si la versión ya no es la esperada (o la carta no es de la empresa). */
  actualizar(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    cambios: CambiosDeCartaPublica,
  ): Promise<CartaPublica | null>;
}

export function crearRepositorioDeCartas(db: Kysely<CatalogoDb>): RepositorioDeCartas {
  async function leer(empresa: EmpresaId, id: string, bloquear: boolean) {
    if (!esUuid(id)) return null;
    let consulta = db
      .selectFrom("carta_publica")
      .selectAll()
      .where("empresa_id", "=", empresa)
      .where("id", "=", id);
    if (bloquear) consulta = consulta.forUpdate();
    const fila = await consulta.executeTakeFirst();
    return fila === undefined ? null : aCartaPublica(fila);
  }
  return {
    obtener: (empresa, id) => leer(empresa, id, false),
    bloquear: (empresa, id) => leer(empresa, id, true),
    async deLaSucursal(empresa, sucursal) {
      if (!esUuid(sucursal)) return null;
      const fila = await db
        .selectFrom("carta_publica")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal)
        .executeTakeFirst();
      return fila === undefined ? null : aCartaPublica(fila);
    },
    async insertar(empresa, alta) {
      const nueva = () =>
        db.insertInto("carta_publica").values({
          id: alta.id,
          empresa_id: empresa,
          sucursal_id: alta.sucursalId,
          codigo: alta.codigo,
          nombre: alta.nombre,
          rubro: alta.rubro,
          lugar: alta.lugar,
          mensaje_de_portada: alta.mensajeDePortada,
          estado: alta.estado,
          creado_por: alta.creadoPor,
        });
      const fila = await insertarIdempotente(
        () =>
          nueva()
            .onConflict((oc) => oc.doNothing())
            .returning("id")
            .executeTakeFirst(),
        async () =>
          (await db
            .selectFrom("carta_publica")
            .select("id")
            .where("empresa_id", "=", empresa)
            .where("id", "=", alta.id)
            .executeTakeFirst()) !== undefined,
        () => nueva().returning("id").executeTakeFirstOrThrow(),
      );
      return fila !== undefined;
    },
    async actualizar(empresa, id, versionEsperada, cambios) {
      if (!esUuid(id)) return null;
      const fila = await db
        .updateTable("carta_publica")
        .set({
          nombre: cambios.nombre,
          rubro: cambios.rubro,
          lugar: cambios.lugar,
          mensaje_de_portada: cambios.mensajeDePortada,
          estado: cambios.estado,
        })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aCartaPublica(fila);
    },
  };
}
