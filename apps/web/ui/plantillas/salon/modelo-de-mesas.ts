import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { armarElPlano, type MedidasDelSalon, type PlanoArmado } from "./modelo-del-plano";

/**
 * El modelo de vista de la pantalla «Mesas» del salón (S-1; maqueta aprobada `mesas.html`, 09/11/2026): de lo que entrega la composición, lo que se ve en la lista y en el formulario, y NADA
 * más. Puro: sin React ni servidor. Los textos salen del catálogo (`salon.texto.admin_*`, con su fuente en `catalogo-salon.ts`); no se arma ningún texto nuevo, solo se eligen los aprobados.
 *
 * Reglas (cada una con su prueba en `test/web/mesas-modelo.test.ts`):
 *  - **Por número, activas y desactivadas** (la maqueta las lista todas, las desactivadas con la marca «Desactivada»); el orden lo da el servidor.
 *  - **Lo que cambia algo sale solo si la persona puede administrar las mesas** (`puedeAdministrar`, solo una ayuda: el guard decide): sin permiso «Agregar mesa» no se ofrece y
 *    «Editar mesa», «Desactivar» y «Reactivar» salen apagados. Todo lo que no sea exactamente `true` cierra.
 *  - **El plano dibuja todas las mesas, las desactivadas atenuadas** (S-1b, `modelo-del-plano.ts`) con las medidas del salón que entrega el servidor; no decide nada: el servidor valida al guardar.
 *  - **Forma y tamaño son listas cerradas** que repiten los valores del dominio (`FORMAS_DE_MESA`, `TAMANOS_DE_MESA`): una prueba falla si difieren.
 */

export const RUTA_DE_MESAS = "/salon/mesas";
const RUTA_DE_LA_MESA_NUEVA = `${RUTA_DE_MESAS}/nueva`;
const rutaDeLaMesa = (id: string): string => `${RUTA_DE_MESAS}/${id}`;

/** Los valores de forma y tamaño tal como los guarda el dominio, con el texto aprobado de cada uno. */
export const FORMAS = [
  { valor: "REDONDA", clave: "salon.texto.admin_redonda" },
  { valor: "CUADRADA", clave: "salon.texto.admin_cuadrada" },
  { valor: "LARGA", clave: "salon.texto.admin_larga" },
] as const;
export const TAMANOS = [
  { valor: "CHICA", clave: "salon.texto.admin_chica" },
  { valor: "MEDIANA", clave: "salon.texto.admin_mediana" },
  { valor: "GRANDE", clave: "salon.texto.admin_grande" },
] as const;

const textoDe = (
  lista: readonly Readonly<{
    valor: string;
    clave:
      | "salon.texto.admin_redonda"
      | "salon.texto.admin_cuadrada"
      | "salon.texto.admin_larga"
      | "salon.texto.admin_chica"
      | "salon.texto.admin_mediana"
      | "salon.texto.admin_grande";
  }>[],
  valor: string,
  d: DiccionarioResuelto,
): string => {
  const hallada = lista.find((x) => x.valor === valor);
  return hallada === undefined ? "" : texto(d, hallada.clave);
};

/** Una mesa como la entrega la composición (la UI no importa los módulos). */
export type MesaDeLaLista = Readonly<{
  id: string;
  numero: number;
  forma: string;
  tamano: string;
  columna: number;
  fila: number;
  activa: boolean;
  version: number;
}>;

/** «Desactivar» si está activa, «Reactivar» si no; apagado si la persona no puede administrar. */
type EstadoArmado = Readonly<{ reactivar: boolean; texto: string; apagado: boolean }>;

type FilaDeMesa = Readonly<{
  id: string;
  /** «Mesa 7». */
  titulo: string;
  /** «Desactivada»; `null` si la mesa está activa. */
  marca: string | null;
  /** «Redonda · Chica · Columna 1 · Fila 1». */
  detalle: string;
  editar: Readonly<{ texto: string; href: string | null }>;
  estado: EstadoArmado;
}>;

export type ListaDeMesasArmada = Readonly<{
  /** El mapa chico del salón, arriba de la lista: todas las mesas (las desactivadas atenuadas); cada activa lleva a su edición si la persona puede administrar. */
  plano: PlanoArmado;
  filas: readonly FilaDeMesa[];
  /** «Agregar mesa»; `null` si la persona no puede administrar. */
  nueva: Readonly<{ href: string; texto: string }> | null;
}>;

/** Todo lo que no sea exactamente `true` (falso, ausente, dudoso) cierra. */
const puede = (puedeAdministrar: boolean | undefined): boolean => puedeAdministrar === true;

export function armarLaListaDeMesas(
  mesas: readonly MesaDeLaLista[],
  puedeAdministrar: boolean | undefined,
  medidas: MedidasDelSalon,
  d: DiccionarioResuelto = {},
): ListaDeMesasArmada {
  const administra = puede(puedeAdministrar);
  return {
    plano: armarElPlano(
      {
        medidas,
        mesas: mesas.map((m) => ({ ...m, href: administra ? rutaDeLaMesa(m.id) : null })),
      },
      d,
    ),
    filas: mesas.map((m) => ({
      id: m.id,
      titulo: texto(d, "salon.texto.admin_mesa_numero", { numero: String(m.numero) }),
      marca: m.activa ? null : texto(d, "salon.texto.admin_desactivada"),
      detalle: [
        textoDe(FORMAS, m.forma, d),
        textoDe(TAMANOS, m.tamano, d),
        `${texto(d, "salon.texto.admin_columna")} ${String(m.columna)}`,
        `${texto(d, "salon.texto.admin_fila")} ${String(m.fila)}`,
      ].join(" · "),
      editar: {
        texto: texto(d, "salon.texto.admin_editar_mesa"),
        href: administra && m.activa ? rutaDeLaMesa(m.id) : null,
      },
      estado: {
        reactivar: !m.activa,
        texto: texto(d, m.activa ? "salon.texto.admin_desactivar" : "salon.texto.admin_reactivar"),
        apagado: !administra,
      },
    })),
    nueva: administra
      ? { href: RUTA_DE_LA_MESA_NUEVA, texto: texto(d, "salon.texto.admin_agregar_mesa") }
      : null,
  };
}

/** Lo que el formulario necesita del salón para dibujar el plano: las medidas y las mesas de la sucursal (la que se edita se descuenta). */
export type DatosDelSalonParaElPlano = Readonly<{
  medidas: MedidasDelSalon;
  mesas: readonly MesaDeLaLista[];
}>;

export type FormularioDeMesaArmado = Readonly<{
  titulo: string;
  numero: Readonly<{ etiqueta: string; valorInicial: string }>;
  forma: Readonly<{
    etiqueta: string;
    valorInicial: string;
    opciones: readonly Readonly<{ valor: string; etiqueta: string }>[];
  }>;
  tamano: Readonly<{
    etiqueta: string;
    valorInicial: string;
    opciones: readonly Readonly<{ valor: string; etiqueta: string }>[];
  }>;
  columna: Readonly<{ etiqueta: string; valorInicial: string }>;
  fila: Readonly<{ etiqueta: string; valorInicial: string }>;
  guardar: string;
  cancelar: Readonly<{ href: string; texto: string }>;
  volver: Readonly<{ href: string; etiqueta: string }>;
  /**
   * El mapa chico: `base` con las demás mesas activas (ya con sus textos); el navegador le suma la mesa que se escribe (`conElBorrador`) con las `medidas` y el nombre ya armado.
   */
  plano: Readonly<{
    base: PlanoArmado;
    medidas: MedidasDelSalon;
    nombreDelBorrador: string;
  }>;
  /** Si el servidor deja guardar hoy: si no, «Guardar» sale apagado (solo una ayuda: el guard decide; DEC-0346). */
  puedeGuardar: boolean;
}>;

/**
 * El formulario: para una mesa nueva, número, columna y fila vacíos y la forma y el tamaño que propone la maqueta (Redonda, Chica); para editar, con los datos de la mesa para editar. «Cancelar» y ‹ vuelven a la lista, como en la maqueta.
 * SUPUESTO (DEC-0462): la posición inicial de una mesa nueva queda en blanco (la maqueta propone la primera casilla libre; calcularla es regla del servidor y no está pedida).
 */
export function armarElFormularioDeMesa(
  mesa: MesaDeLaLista | null,
  puedeAdministrar: boolean | undefined,
  salon: DatosDelSalonParaElPlano,
  d: DiccionarioResuelto = {},
): FormularioDeMesaArmado {
  const titulo = texto(
    d,
    mesa === null ? "salon.texto.admin_agregar_mesa" : "salon.texto.admin_editar_mesa",
  );
  return {
    titulo,
    plano: {
      base: armarElPlano(
        {
          medidas: salon.medidas,
          mesas: salon.mesas.filter((m) => m.id !== mesa?.id).map((m) => ({ ...m, href: null })),
        },
        d,
      ),
      medidas: salon.medidas,
      nombreDelBorrador: titulo,
    },
    numero: {
      etiqueta: texto(d, "salon.texto.admin_numero"),
      valorInicial: mesa === null ? "" : String(mesa.numero),
    },
    forma: {
      etiqueta: texto(d, "salon.texto.admin_forma"),
      valorInicial: mesa === null ? FORMAS[0].valor : mesa.forma,
      opciones: FORMAS.map((f) => ({ valor: f.valor, etiqueta: texto(d, f.clave) })),
    },
    tamano: {
      etiqueta: texto(d, "salon.texto.admin_tamano"),
      valorInicial: mesa === null ? TAMANOS[0].valor : mesa.tamano,
      opciones: TAMANOS.map((t) => ({ valor: t.valor, etiqueta: texto(d, t.clave) })),
    },
    columna: {
      etiqueta: texto(d, "salon.texto.admin_columna"),
      valorInicial: mesa === null ? "" : String(mesa.columna),
    },
    fila: {
      etiqueta: texto(d, "salon.texto.admin_fila"),
      valorInicial: mesa === null ? "" : String(mesa.fila),
    },
    guardar: texto(d, "salon.texto.admin_guardar"),
    cancelar: { href: RUTA_DE_MESAS, texto: texto(d, "catalogo.accion.cancelar") },
    volver: { href: RUTA_DE_MESAS, etiqueta: texto(d, "catalogo.seccion.volver_a_la_lista") },
    puedeGuardar: puede(puedeAdministrar),
  };
}
