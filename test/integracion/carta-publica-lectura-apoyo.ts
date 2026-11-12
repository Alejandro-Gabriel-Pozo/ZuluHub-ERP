import { randomUUID } from "node:crypto";
import {
  crearVidrieraPublica,
  type TxPublicaDeCarta,
} from "../../src/adaptadores/postgres/vidriera-publica";
import {
  crearTransaccionesPublicas,
  type TransaccionesPublicasDePostgres,
} from "../../src/adaptadores/postgres/transacciones-publicas";
import { crearLecturaPublicaDeCartas } from "../../src/modulos/catalogo/publico";
import type { VidrieraPublica } from "../../src/puertos/vidriera-publica";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../utilidades/marcas";
import type { montarCatalogo } from "./catalogo-apoyo";
import {
  grupoDeBase,
  opcionDeBase,
  precioDeBase,
  productoDeBase,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * Apoyo de las pruebas de la lectura pública de la carta (T3): el ensayo de §8.1 de la especificación armado con SQL del dueño de la base (que evade RLS: solo
 * monta el escenario) y el adaptador REAL sobre el rol `pedernal_publico` verdadero. Lo que se prueba pasa siempre por el rol real o por los casos de uso.
 */
export const MARCA_DEL_HOST = MARCA_PRINCIPAL_DE_PRUEBA as string;
export const OTRA_MARCA = "00000000-0000-4000-8000-0000000000b9";
/** La hora de las visitas por defecto: después de todos los precios del ensayo. */
export const AHORA_DE_LA_VISITA = new Date("2026-11-12T12:00:00Z");
const DESDE = "2026-10-01T00:00:00Z";

export type Catalogo = Awaited<ReturnType<typeof montarCatalogo>>;

/** El puerto real y la conexión pública que lo sostiene (hay que cerrarla). */
export function adaptadorReal(
  c: Catalogo,
  ahora: () => Date = () => AHORA_DE_LA_VISITA,
): { vidriera: VidrieraPublica; publicas: TransaccionesPublicasDePostgres<TxPublicaDeCarta> } {
  const publicas = crearTransaccionesPublicas<TxPublicaDeCarta>({
    url: c.propia.base.publico,
    armar: (db) => ({ cartas: crearLecturaPublicaDeCartas(db) }),
  });
  return { vidriera: crearVidrieraPublica(publicas, { ahora }), publicas };
}

export type Ensayo = Readonly<{
  e: EscenarioDeCatalogo;
  secciones: Readonly<
    Record<"entradas" | "platos" | "postres" | "cafeteria" | "meriendas", string>
  >;
  p: Readonly<
    Record<
      "empanada" | "milanesa" | "flan" | "cafe" | "helado" | "tarta" | "sopa" | "budin",
      string
    >
  >;
  /** Las opciones que importan, por nombre. */
  o: Readonly<
    Record<
      "pure" | "ensalada" | "papas" | "huevo" | "chico" | "mediano" | "grande" | "carne" | "pollo",
      string
    >
  >;
  /** Los códigos de la carta de la primera sucursal (la de «Huinganco») y de la segunda. */
  carta1: Readonly<{ id: string; codigo: string }>;
  carta2: Readonly<{ id: string; codigo: string }>;
}>;

/** Una empresa con el ensayo de §8.1: dos sucursales con carta EN LÍNEA cada una, secciones, productos, precios, grupos y opciones. */
export async function montarEnsayo(c: Catalogo): Promise<Ensayo> {
  const e = await c.escenario();
  const q = (sql: string, p: unknown[]) => c.dueno.query(sql, p);
  const seccion = async (nombre: string, orden: number, activa = true) => {
    const id = randomUUID();
    await q(
      "insert into seccion_de_carta (id, empresa_id, nombre, nombre_clave, orden, activa) values ($1, $2, $3, $4, $5, $6)",
      [id, e.empresa, nombre, nombre.toLowerCase(), orden, activa],
    );
    return id;
  };
  const producto = async (
    nombre: string,
    seccionId: string | null,
    activo = true,
    descripcion: string | null = null,
  ) => {
    const id = await productoDeBase(c.dueno, e.empresa, { nombre, activo });
    await q(
      "update producto set seccion_de_carta_id = $2, descripcion_en_carta = $3 where id = $1",
      [id, seccionId, descripcion],
    );
    return id;
  };
  const precio = (
    productoId: string,
    valor: string | null,
    extra: { opcion?: string; sucursal?: string; desde?: string } = {},
  ) =>
    precioDeBase(c.dueno, {
      empresa: e.empresa,
      producto: productoId,
      precio: valor,
      desde: extra.desde ?? DESDE,
      ...(extra.opcion === undefined ? {} : { opcion: extra.opcion }),
      ...(extra.sucursal === undefined ? {} : { sucursal: extra.sucursal }),
    });
  const opcion = async (
    productoId: string,
    grupo: string,
    nombre: string,
    orden: number,
    recargo = "0",
  ) => {
    const { opcion: id } = await opcionDeBase(c.dueno, e.empresa, productoId, grupo, {
      nombre,
      recargo,
    });
    await q("update opcion set orden = $2 where id = $1", [id, orden]);
    return id;
  };
  const secciones = {
    entradas: await seccion("Entradas", 0),
    platos: await seccion("Platos", 1),
    postres: await seccion("Postres", 2),
    cafeteria: await seccion("Cafetería", 3),
    meriendas: await seccion("Meriendas", 4, false),
  };
  const empanada = await producto(
    "Empanada de carne",
    secciones.entradas,
    true,
    "Frita o al horno",
  );
  await precio(empanada, "1500");
  const milanesa = await producto("Milanesa napolitana", secciones.platos);
  await precio(milanesa, "9500");
  const guarnicion = await grupoDeBase(c.dueno, e.empresa, milanesa, {
    clase: "INCLUIDA",
    nombre: "Guarnición",
    esObligatorio: true,
    seMuestraEnCarta: true,
    orden: 0,
  });
  const pure = await opcion(milanesa, guarnicion, "Puré", 0);
  const ensalada = await opcion(milanesa, guarnicion, "Ensalada", 1);
  const papas = await opcion(milanesa, guarnicion, "Papas fritas", 2);
  const extras = await grupoDeBase(c.dueno, e.empresa, milanesa, {
    clase: "ADICIONAL",
    nombre: "Extras",
    esObligatorio: false,
    seMuestraEnCarta: true,
    orden: 1,
  });
  const huevo = await opcion(milanesa, extras, "Huevo frito", 0, "400");
  const proteina = await grupoDeBase(c.dueno, e.empresa, milanesa, {
    clase: "ADICIONAL",
    nombre: "Proteína",
    esObligatorio: false,
    seMuestraEnCarta: false,
    orden: 2,
  });
  const carne = await opcion(milanesa, proteina, "Carne", 0);
  const pollo = await opcion(milanesa, proteina, "Pollo", 1);
  const flan = await producto("Flan", secciones.postres);
  await precio(flan, "4200.50");
  const cafe = await producto("Café", secciones.cafeteria);
  const tamano = await grupoDeBase(c.dueno, e.empresa, cafe, {
    clase: "VARIANTE",
    nombre: "Tamaño",
    esTamano: true,
    orden: 0,
  });
  const chico = await opcion(cafe, tamano, "Chico", 0);
  const mediano = await opcion(cafe, tamano, "Mediano", 1);
  const grande = await opcion(cafe, tamano, "Grande", 2);
  await precio(cafe, "2000", { opcion: chico });
  await precio(cafe, "2500", { opcion: mediano });
  await precio(cafe, "3000", { opcion: grande });
  const helado = await producto("Helado", secciones.postres);
  await precio(helado, null);
  const tarta = await producto("Tarta de ricota", secciones.postres, false);
  await precio(tarta, "3800");
  const sopa = await producto("Sopa del día", null);
  await precio(sopa, "3000");
  const budin = await producto("Budín", secciones.meriendas);
  await precio(budin, "2800");
  const crear = async (sucursalId: string) => {
    const r = valorDe(
      await c.casos.guardarCartaPublica(e.gerente, {
        id: randomUUID(),
        sucursalId,
        nombre: "Parador El Ensayo",
        estado: "EN_LINEA",
      }),
    );
    return { id: r.cartaId, codigo: r.codigo };
  };
  return {
    e,
    secciones,
    p: { empanada, milanesa, flan, cafe, helado, tarta, sopa, budin },
    o: { pure, ensalada, papas, huevo, chico, mediano, grande, carne, pollo },
    carta1: await crear(e.sucursal),
    carta2: await crear(e.otraSucursal),
  };
}

export { precioDeBase };
