import { estadoEfectivo, puedeOperar } from "../../../contexto/estados";
import type { EstadoDeEmpresa, EstadoDeTenant } from "../../../contexto/estados";
import type { EmpresaId, SucursalId, TenantId } from "../../../primitivas/identificadores/marca";
import type {
  GrupoConRecargos,
  OpcionConRecargo,
} from "../../../capacidades/experiencia/vidriera/precios";
import type {
  ProductoPublicado,
  SeccionPublicada,
  VidrieraPublicada,
} from "../../../puertos/vidriera-publica";
import type { AlcanceDelHost } from "../../../capacidades/experiencia/puerta";
import type { PartesDeDireccion } from "../../../capacidades/activos/direccion-externa";
import type { CaraDeVidriera } from "../../../capacidades/experiencia/vidriera/caras";
import type { ModeloDeVidriera } from "../../../capacidades/experiencia/vidriera/modelos";
import { ocultoPor, type Disponibilidad, type EstadoDeCarta } from "./carta-publica";
import { filaConPrecio } from "./fila-con-precio";

/**
 * De lo que lee la puerta pública a lo que el comensal ve (carta real §4.3 y §4.4): una función PURA, sin base ni reloj. El lector (persistencia) solo trae filas y
 * `precio_vigente` de la base; TODA la decisión de qué sale y a qué precio vive acá, una sola vez, para que una prueba pura la ejerza con valores exactos.
 */

/** Lo que devolvió `precio_vigente` para un alcance: el precio (texto decimal, `null` si es «precio abierto» o «vuelve al de la empresa») y de quién es. */
export type PrecioLeido = Readonly<{ precio: string | null; sucursalId: string | null }>;

export type OpcionLeida = Readonly<{
  nombre: string;
  /** El recargo de la EMPRESA de la última versión de la opción (texto decimal). */
  recargoDeLaVersion: string;
  /**
   * `precio_vigente` de ESTA opción en la sucursal de la carta: en una opción de un grupo de tamaño es el precio final del tamaño; en un adicional, el recargo propio de
   * la sucursal (si lo hay). `null` si no hay ninguna fila.
   */
  precio: PrecioLeido | null;
}>;

export type GrupoLeido = Readonly<{
  titulo: string;
  clase: "VARIANTE" | "INCLUIDA" | "ADICIONAL";
  esObligatorio: boolean;
  /** Las opciones ACTIVAS, en el orden del comerciante. */
  opciones: readonly OpcionLeida[];
}>;

export type ProductoLeido = Readonly<{
  id: string;
  nombre: string;
  descripcion: string | null;
  seccionId: string;
  activo: boolean;
  /** `precio_vigente` del producto (sin opción) en la sucursal de la carta; `null` si no se leyó o no hay fila. */
  precioBase: PrecioLeido | null;
  /** Los grupos ACTIVOS que SE MUESTRAN en la carta, en su orden. */
  grupos: readonly GrupoLeido[];
}>;

export type SeccionLeida = Readonly<{ id: string; nombre: string; activa: boolean }>;

export type CartaLeida = Readonly<{
  carta: Readonly<{
    id: string;
    codigo: string;
    nombre: string;
    rubro: string | null;
    lugar: string | null;
    mensajeDePortada: string | null;
    estado: EstadoDeCarta;
    sucursalId: SucursalId;
    /** Lo que eligió la carta (0077), tal cual está guardado. Vacío = usa lo de la empresa. */
    modelo: ModeloDeVidriera;
    cara: CaraDeVidriera | null;
    colorPropio: string | null;
    logo: PartesDeDireccion | null;
  }>;
  /** El color de la empresa para sus cartas (`identidad_de_carta_empresa.color_principal`); `null` si no cargó ninguno (rige el color de la marca). */
  colorDeLaEmpresa: string | null;
  sucursalActiva: boolean;
  /** La empresa dueña de la carta y su tenant: con ellos la puerta pública lee el plan (T6), siempre acotado por el código de la carta. */
  empresaId: EmpresaId;
  tenantId: TenantId;
  /** La marca del tenant de la empresa (`tenant.marca_id`). */
  marcaId: string;
  estadoDeLaEmpresa: EstadoDeEmpresa;
  estadoDelTenant: EstadoDeTenant;
  /** En el orden de la carta (`orden`, `id`). */
  secciones: readonly SeccionLeida[];
  /** En el orden alfabético de la carta (`nombre_clave`, `id`). */
  productos: readonly ProductoLeido[];
  /** Las filas de «Ocultar» de la empresa y de la sucursal de la carta, de todos los productos. */
  disponibilidad: readonly Pick<Disponibilidad, "productoId" | "sucursalId" | "oculto">[];
}>;

const CERO = "0";

const opcionConRecargo = (nombre: string, recargo: string): OpcionConRecargo => ({
  nombre,
  recargo,
});

/**
 * El recargo de una opción que NO es de tamaño: el propio de la sucursal si lo hay (fila de la sucursal con precio), si no el de la empresa de la última versión.
 * Es la MISMA regla que usa la cotización de la caja (`armarInstantanea`).
 */
function recargoDe(opcion: OpcionLeida): string {
  const propia = opcion.precio;
  return filaConPrecio(propia) && propia.sucursalId !== null
    ? propia.precio
    : opcion.recargoDeLaVersion;
}

function gruposConRecargos(
  grupos: readonly GrupoLeido[],
  incluir: (g: GrupoLeido) => boolean,
): readonly GrupoConRecargos[] {
  return grupos
    .filter((g) => g.opciones.length > 0 && incluir(g))
    .map((g) => ({
      titulo: g.titulo,
      opciones: g.opciones.map((o) =>
        opcionConRecargo(o.nombre, g.clase === "INCLUIDA" ? CERO : recargoDe(o)),
      ),
    }));
}

/**
 * Un producto de la carta, o `null` si no sale: sin precio para la carta en esa sucursal. Con tamaños (un grupo de variante), cada tamaño con precio sale con su
 * precio FINAL como recargo sobre un precio base «0» (T-5: evita restas entre precios y recargos negativos; el importe final es el mismo, exacto); si ninguno tiene
 * precio, el producto no sale. Sin tamaños, sale con su precio base. Los grupos obligatorios (la guarnición incluida y los adicionales obligatorios) y los opcionales
 * van aparte; un grupo sin opciones activas se omite.
 */
function productoPublicado(p: ProductoLeido): ProductoPublicado | null {
  const variante = p.grupos.find((g) => g.clase === "VARIANTE");
  let precioBase: string;
  let tamanos: readonly OpcionConRecargo[] = [];
  if (variante === undefined) {
    if (!filaConPrecio(p.precioBase)) return null;
    precioBase = p.precioBase.precio;
  } else {
    tamanos = variante.opciones.flatMap((o) =>
      filaConPrecio(o.precio) ? [opcionConRecargo(o.nombre, o.precio.precio)] : [],
    );
    if (tamanos.length === 0) return null;
    precioBase = CERO;
  }
  return {
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion,
    agotado: false,
    foto: null,
    precioBase,
    tamanos,
    obligatorios: gruposConRecargos(p.grupos, (g) => g.clase !== "VARIANTE" && g.esObligatorio),
    adicionales: gruposConRecargos(p.grupos, (g) => g.clase !== "VARIANTE" && !g.esObligatorio),
  };
}

/**
 * Lista de permitidos (todo nace cerrado): un host de MARCA sirve la carta de cualquiera de sus empresas; uno de EMPRESA, solo la de esa empresa; un dueño que no es
 * ninguno de los dos (un llamador sin tipos) no sirve nada. Previene H-DOM-1: un host dedicado a la empresa A servía la carta de la B de la misma marca.
 */
function elDuenioDelHostLaSirve(duenio: AlcanceDelHost["duenio"], empresa: EmpresaId): boolean {
  if (duenio.tipo === "MARCA") return true;
  return duenio.tipo === "EMPRESA" && duenio.empresaId === empresa;
}

/**
 * La carta que ve el comensal, o `null` si no se sirve (la misma respuesta para todos los motivos: no hay oráculo). No se sirve si: la carta no está en línea; su
 * sucursal está cerrada; la marca del tenant no es la del host; el host es de una empresa y la carta es de otra; la empresa no opera. Sale cada producto activo, con sección activa, que NO está oculto en esa sucursal
 * (la regla única `ocultoPor`) y con precio para la carta; una sección sin productos no sale. El orden de secciones y productos es el de la entrada.
 */
export function armarVidrieraPublicada(
  leida: CartaLeida,
  host: AlcanceDelHost,
): VidrieraPublicada | null {
  if (leida.carta.estado !== "EN_LINEA" || !leida.sucursalActiva) return null;
  if (leida.marcaId !== host.marcaId) return null;
  if (!elDuenioDelHostLaSirve(host.duenio, leida.empresaId)) return null;
  if (!puedeOperar(estadoEfectivo(leida.estadoDelTenant, leida.estadoDeLaEmpresa))) return null;

  const secciones = leida.secciones
    .filter((s) => s.activa)
    .flatMap((seccion): SeccionPublicada[] => {
      const productos = leida.productos.flatMap((p): ProductoPublicado[] => {
        if (!p.activo || p.seccionId !== seccion.id) return [];
        const filas = leida.disponibilidad.filter((d) => d.productoId === p.id);
        if (ocultoPor(filas, leida.carta.sucursalId) !== null) return [];
        const publicado = productoPublicado(p);
        return publicado === null ? [] : [publicado];
      });
      return productos.length === 0 ? [] : [{ id: seccion.id, nombre: seccion.nombre, productos }];
    });
  return {
    id: leida.carta.id,
    codigo: leida.carta.codigo,
    nombre: leida.carta.nombre,
    rubro: leida.carta.rubro,
    lugar: leida.carta.lugar,
    mensajeDePortada: leida.carta.mensajeDePortada,
    // Lo ELEGIDO, sin ajustar. Punto de enganche de los tokens ya resueltos (color ajustado por contraste 7:1, texto blanco o negro, tema por cara): los calcula la
    // primitiva pura de la sesión C5 al armar la vista; no se duplica acá ni se guarda.
    identidad: {
      modelo: leida.carta.modelo,
      cara: leida.carta.cara,
      colorPropio: leida.carta.colorPropio,
      colorDeLaEmpresa: leida.colorDeLaEmpresa,
      logo: leida.carta.logo,
    },
    letraBase: "NORMAL",
    secciones,
  };
}
