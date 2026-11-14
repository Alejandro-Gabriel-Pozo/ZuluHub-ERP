import { sql, type Kysely } from "kysely";
import type { EstadoDeEmpresa, EstadoDeTenant } from "../../../contexto/estados";
import { empresaId, sucursalId, tenantId } from "../../../primitivas/identificadores/marca";
import { ocultoPor } from "../dominio/carta-publica";
import type {
  CartaLeida,
  GrupoLeido,
  OpcionLeida,
  PrecioLeido,
  ProductoLeido,
} from "../dominio/carta-publicada";
import { productoId } from "../dominio/identificadores";
import type { CatalogoDb } from "./esquema";
import { crearRepositorioDePrecios } from "./repositorio-de-precios";

/** Las tres tablas que la carta pública mira y no son del catálogo (0044: columnas exactas). */
export type PublicoDeCartaDb = {
  empresa: { id: string; tenant_id: string; estado: string };
  tenant: { id: string; estado: string; marca_id: string };
  sucursal: { id: string; empresa_id: string; activa: boolean };
};

/**
 * La lectura de la puerta pública de una carta (carta real §4): SOLO LECTURA, con el rol `pedernal_publico` y dentro de UNA transacción de foto fija. Sin contexto
 * firmado: lo que se ve lo deciden los `GRANT` por columna y las políticas de 0043 y 0044, que miran `app.codigo_de_carta`. Trae FILAS; qué sale y a qué precio lo
 * decide `armarVidrieraPublicada` (pura). Cada consulta lleva su lista de columnas explícita: el rol no puede leer nada fuera de lo otorgado y una columna que se
 * agregue acá sin otorgarla falla en las pruebas.
 */
export interface LecturaPublicaDeCartas {
  /** `null` si el código no es de una carta en línea (también si su sucursal está cerrada): la misma respuesta para todo, sin oráculo. */
  porCodigo(codigo: string, ahora: Date): Promise<CartaLeida | null>;
}

const COMO_ESTADO_DE_EMPRESA: readonly EstadoDeEmpresa[] = [
  "PROVISIONING",
  "ACTIVE",
  "SUSPENDED",
  "CANCELLED",
  "DELETING",
];
const COMO_ESTADO_DE_TENANT: readonly EstadoDeTenant[] = ["ACTIVE", "SUSPENDED"];

/** Lo que la base guarda y el dominio no conoce es una falla, no un dato: nunca se sirve a ciegas. */
function estadoDe<E extends string>(permitidos: readonly E[], texto: string): E {
  const estado = permitidos.find((e) => e === texto);
  if (estado === undefined) throw new RangeError(`estado inválido en la base: ${texto}`);
  return estado;
}

const aPrecioLeido = (
  f: Readonly<{ precio: string | null; sucursalId: string | null }> | null,
): PrecioLeido | null => (f === null ? null : { precio: f.precio, sucursalId: f.sucursalId });

export function crearLecturaPublicaDeCartas(db: {
  withTables<T extends object>(): Kysely<T & CatalogoDb & PublicoDeCartaDb>;
}): LecturaPublicaDeCartas {
  const k = db.withTables<object>();
  const precios = crearRepositorioDePrecios(k);
  return {
    async porCodigo(codigo, ahora) {
      // El código de la visita: desde acá y hasta el final de la transacción, las políticas dejan ver solo esa carta (y solo si está en línea).
      await sql`select set_config('app.codigo_de_carta', ${codigo}, true)`.execute(k);
      const cartaFila = await k
        .selectFrom("carta_publica")
        .select([
          "id",
          "empresa_id",
          "sucursal_id",
          "codigo",
          "nombre",
          "rubro",
          "lugar",
          "mensaje_de_portada",
          "estado",
        ])
        .where("codigo", "=", codigo)
        .executeTakeFirst();
      if (cartaFila === undefined) return null;
      const empresa = cartaFila.empresa_id;
      const sucursal = await k
        .selectFrom("sucursal")
        .select(["id", "activa"])
        .where("id", "=", cartaFila.sucursal_id)
        .where("empresa_id", "=", empresa)
        .executeTakeFirst();
      const empresaFila = await k
        .selectFrom("empresa")
        .select(["id", "tenant_id", "estado"])
        .where("id", "=", empresa)
        .executeTakeFirst();
      if (sucursal === undefined || empresaFila === undefined) return null;
      const tenantFila = await k
        .selectFrom("tenant")
        .select(["id", "estado", "marca_id"])
        .where("id", "=", empresaFila.tenant_id)
        .executeTakeFirst();
      if (tenantFila === undefined) return null;

      const secciones = await k
        .selectFrom("seccion_de_carta")
        .select(["id", "nombre", "activa"])
        .where("empresa_id", "=", empresa)
        .orderBy("orden")
        .orderBy("id")
        .execute();
      const productosFilas = await k
        .selectFrom("producto")
        .select(["id", "nombre", "descripcion_en_carta", "seccion_de_carta_id", "activo"])
        .where("empresa_id", "=", empresa)
        .orderBy("nombre_clave")
        .orderBy("id")
        .execute();
      const disponibilidad = (
        await k
          .selectFrom("disponibilidad_de_producto")
          .select(["producto_id", "sucursal_id", "oculto"])
          .where("empresa_id", "=", empresa)
          .execute()
      ).map((d) => ({
        productoId: productoId(d.producto_id),
        sucursalId: d.sucursal_id === null ? null : sucursalId(d.sucursal_id),
        oculto: d.oculto,
      }));

      // Lo oculto en esta sucursal no se mira más (ni sus grupos ni sus precios): la regla es la única de `ocultoPor`.
      const sucursalDeLaCarta = sucursalId(cartaFila.sucursal_id);
      const visibles = productosFilas.filter(
        (p) =>
          ocultoPor(
            disponibilidad.filter((d) => d.productoId === p.id),
            sucursalDeLaCarta,
          ) === null,
      );
      const ids = visibles.map((p) => p.id);
      const gruposFilas =
        ids.length === 0
          ? []
          : await k
              .selectFrom("grupo_de_elecciones")
              .select(["id", "producto_id", "clase", "nombre", "es_obligatorio"])
              .where("empresa_id", "=", empresa)
              .where("producto_id", "in", ids)
              .orderBy("producto_id")
              .orderBy("orden")
              .orderBy("id")
              .execute();
      const gruposIds = gruposFilas.map((g) => g.id);
      const opcionesFilas =
        gruposIds.length === 0
          ? []
          : await k
              .selectFrom("opcion")
              .select(["id", "grupo_id"])
              .where("empresa_id", "=", empresa)
              .where("grupo_id", "in", gruposIds)
              .orderBy("grupo_id")
              .orderBy("orden")
              .orderBy("id")
              .execute();
      const versiones = new Map<string, { numero: number; nombre: string; recargo: string }>();
      if (opcionesFilas.length > 0) {
        const filas = await k
          .selectFrom("version_de_opcion")
          .select(["opcion_id", "numero", "nombre", "recargo"])
          .where("empresa_id", "=", empresa)
          .where(
            "opcion_id",
            "in",
            opcionesFilas.map((o) => o.id),
          )
          .execute();
        for (const f of filas) {
          const actual = versiones.get(f.opcion_id);
          if (actual === undefined || f.numero > actual.numero) versiones.set(f.opcion_id, f);
        }
      }

      const precioDe = async (producto: string, opcion: string | null) =>
        aPrecioLeido(
          await precios.vigente(empresaId(empresa), producto, opcion, cartaFila.sucursal_id, ahora),
        );
      const productos: ProductoLeido[] = [];
      for (const p of visibles) {
        if (p.seccion_de_carta_id === null) continue;
        const grupos: GrupoLeido[] = [];
        for (const g of gruposFilas.filter((x) => x.producto_id === p.id)) {
          const clase = estadoDe(["VARIANTE", "INCLUIDA", "ADICIONAL"] as const, g.clase);
          const opciones: OpcionLeida[] = [];
          for (const o of opcionesFilas.filter((x) => x.grupo_id === g.id)) {
            const version = versiones.get(o.id);
            if (version === undefined) continue;
            opciones.push({
              nombre: version.nombre,
              recargoDeLaVersion: version.recargo,
              // Las opciones incluidas no llevan precio propio (recargo siempre 0): no se pregunta.
              precio: clase === "INCLUIDA" ? null : await precioDe(p.id, o.id),
            });
          }
          grupos.push({ titulo: g.nombre, clase, esObligatorio: g.es_obligatorio, opciones });
        }
        const conTamanos = grupos.some((g) => g.clase === "VARIANTE");
        productos.push({
          id: p.id,
          nombre: p.nombre,
          descripcion: p.descripcion_en_carta,
          seccionId: p.seccion_de_carta_id,
          activo: p.activo,
          // Con tamaños el precio vive en cada tamaño: el del producto sin opción no se pregunta.
          precioBase: conTamanos ? null : await precioDe(p.id, null),
          grupos,
        });
      }
      return {
        carta: {
          id: cartaFila.id,
          codigo: cartaFila.codigo,
          nombre: cartaFila.nombre,
          rubro: cartaFila.rubro,
          lugar: cartaFila.lugar,
          mensajeDePortada: cartaFila.mensaje_de_portada,
          estado: estadoDe(["EN_LINEA", "FUERA_DE_LINEA"] as const, cartaFila.estado),
          sucursalId: sucursalDeLaCarta,
        },
        sucursalActiva: sucursal.activa,
        empresaId: empresaId(empresa),
        tenantId: tenantId(tenantFila.id),
        marcaId: tenantFila.marca_id,
        estadoDeLaEmpresa: estadoDe(COMO_ESTADO_DE_EMPRESA, empresaFila.estado),
        estadoDelTenant: estadoDe(COMO_ESTADO_DE_TENANT, tenantFila.estado),
        secciones: secciones.map((s) => ({ id: s.id, nombre: s.nombre, activa: s.activa })),
        productos,
        disponibilidad,
      };
    },
  };
}
