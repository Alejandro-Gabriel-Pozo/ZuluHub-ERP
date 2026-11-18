import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * El modelo de vista del mapa chico del salón (S-1b; maqueta aprobada `mesas.html`, bloque `plano-mini`, 09/11/2026): de las mesas activas y de las medidas del salón, los rectángulos que se
 * dibujan, y NADA más. Puro: sin React ni servidor.
 *
 * Reglas (cada una con su prueba en `test/web/mesas-plano.test.ts`):
 *  - **Las medidas no se copian acá.** La cuadrícula (14 × 9) y las casillas de cada forma y tamaño llegan del servidor (`medidasDelSalon`, que las toma del dominio de salón): una regla, un lugar.
 *  - **El plano solo dibuja; no decide.** No dice si una mesa «entra» ni si «se pisa»: eso lo decide el servidor al guardar (`MESA_FUERA_DEL_SALON`, `MESA_SUPERPUESTA`). Lo que se escribe se
 *    dibuja donde dice; si cae fuera del salón el marco lo corta, y si se encima con otra se ven las dos una sobre otra.
 *  - **Las desactivadas también se dibujan, atenuadas** (la maqueta, clase `off`: «queda en la lista, atenuada»): trazo punteado y colores suaves, y su nombre para el lector de pantalla lleva «Desactivada»; no se
 *    comunican solo por color. No son enlaces (una mesa desactivada no se edita).
 *  - **Lo que no se puede ubicar no se dibuja:** forma o tamaño que no están en las medidas, o columna o fila que no son un número entero de una o dos cifras sin ceros a la izquierda (lista cerrada, cierra ante la duda).
 *  - **Los textos se resuelven en el servidor** (`armarElPlano`, con el diccionario de la empresa); en el navegador solo se suma el borrador (`conElBorrador`) con su nombre ya armado.
 *  - **El estado no es solo color:** cada mesa lleva su número a la vista y su nombre («Mesa 7») para el lector de pantalla; el borrador va con trazo punteado además del color.
 */

/** Las medidas del salón tal como las entrega el servidor (la UI no importa los módulos). */
export type MedidasDelSalon = Readonly<{
  columnas: number;
  filas: number;
  huellas: readonly Readonly<{ forma: string; tamano: string; ancho: number; alto: number }>[];
}>;

/** Una mesa ya guardada, con lo que hace falta para dibujarla; `href` si al tocarla se la edita. */
export type MesaParaElPlano = Readonly<{
  id: string;
  numero: number;
  forma: string;
  tamano: string;
  columna: number;
  fila: number;
  activa: boolean;
  href: string | null;
}>;

/** Lo que se está escribiendo en el formulario, tal cual (texto). */
export type BorradorDelPlano = Readonly<{
  numero: string;
  forma: string;
  tamano: string;
  columna: string;
  fila: string;
}>;

export type MesaDelPlano = Readonly<{
  clave: string;
  /** Lo que se ve dentro de la mesa («7»); vacío si todavía no hay número. */
  numero: string;
  /** Lo que lee el lector de pantalla («Mesa 7»). */
  nombre: string;
  /** La forma tal como la guarda el dominio (`REDONDA`, `CUADRADA`, `LARGA`): la hoja de estilos la dibuja. */
  forma: string;
  /** Posición y tamaño, en porcentaje del plano. */
  izquierda: number;
  arriba: number;
  ancho: number;
  alto: number;
  href: string | null;
  borrador: boolean;
  /** Mesa desactivada: se dibuja atenuada y su nombre lo dice. */
  desactivada: boolean;
}>;

export type PlanoArmado = Readonly<{
  /** «Plano». */
  etiqueta: string;
  columnas: number;
  filas: number;
  mesas: readonly MesaDelPlano[];
}>;

/** Un entero de una o dos cifras, sin ceros a la izquierda; todo lo demás (vacío, signo, decimales, letras) es `null`. */
const entero = (crudo: string): number | null => {
  const limpio = crudo.trim();
  return /^[1-9][0-9]?$/.test(limpio) ? Number.parseInt(limpio, 10) : null;
};

type Rectangulo = Readonly<{
  izquierda: number;
  arriba: number;
  ancho: number;
  alto: number;
}>;

const rectangulo = (
  medidas: MedidasDelSalon,
  forma: string,
  tamano: string,
  columna: number,
  fila: number,
): Rectangulo | null => {
  const huella = medidas.huellas.find((h) => h.forma === forma && h.tamano === tamano);
  if (huella === undefined || medidas.columnas < 1 || medidas.filas < 1) return null;
  return {
    izquierda: ((columna - 1) / medidas.columnas) * 100,
    arriba: ((fila - 1) / medidas.filas) * 100,
    ancho: (huella.ancho / medidas.columnas) * 100,
    alto: (huella.alto / medidas.filas) * 100,
  };
};

/**
 * Arma el plano con las mesas guardadas, por número (el orden lo da el servidor). Corre en el servidor, donde está el diccionario de la empresa: los textos salen ya resueltos. Una mesa cuya
 * forma o tamaño no están en las medidas, o que no se puede ubicar, no se dibuja (cierra ante la duda).
 */
export function armarElPlano(
  datos: Readonly<{ medidas: MedidasDelSalon; mesas: readonly MesaParaElPlano[] }>,
  d: DiccionarioResuelto = {},
): PlanoArmado {
  const mesas = datos.mesas.flatMap((m): MesaDelPlano[] => {
    const r = rectangulo(datos.medidas, m.forma, m.tamano, m.columna, m.fila);
    if (r === null) return [];
    return [
      {
        clave: m.id,
        numero: String(m.numero),
        nombre: m.activa
          ? texto(d, "salon.texto.admin_mesa_numero", { numero: String(m.numero) })
          : `${texto(d, "salon.texto.admin_mesa_numero", { numero: String(m.numero) })}, ${texto(d, "salon.texto.admin_desactivada")}`,
        forma: m.forma,
        ...r,
        href: m.activa ? m.href : null,
        borrador: false,
        desactivada: !m.activa,
      },
    ];
  });
  return {
    etiqueta: texto(d, "salon.texto.admin_plano"),
    columnas: datos.medidas.columnas,
    filas: datos.medidas.filas,
    mesas,
  };
}

/**
 * Suma al plano ya armado la mesa que se está escribiendo (queda encima de las demás). Corre en el navegador en cada cambio del formulario: no usa diccionario, el nombre para el lector de
 * pantalla («Agregar mesa» o «Editar mesa», ya resuelto) llega armado. Sin ubicación válida (columna o fila vacías o que no son número) devuelve el plano tal cual.
 */
export function conElBorrador(
  plano: PlanoArmado,
  medidas: MedidasDelSalon,
  borrador: BorradorDelPlano,
  nombreDelBorrador: string,
): PlanoArmado {
  const columna = entero(borrador.columna);
  const fila = entero(borrador.fila);
  if (columna === null || fila === null) return plano;
  const r = rectangulo(medidas, borrador.forma, borrador.tamano, columna, fila);
  if (r === null) return plano;
  return {
    ...plano,
    mesas: [
      ...plano.mesas,
      {
        clave: "borrador",
        numero: entero(borrador.numero) === null ? "" : borrador.numero.trim(),
        nombre: nombreDelBorrador,
        forma: borrador.forma,
        ...r,
        href: null,
        borrador: true,
        desactivada: false,
      },
    ],
  };
}
