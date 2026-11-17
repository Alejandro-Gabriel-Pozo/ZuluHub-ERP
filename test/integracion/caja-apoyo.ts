import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Intento, SesionDePrueba } from "./sesiones";
import { acepta, type Mundo } from "./fiscal-apoyo";

/**
 * Apoyo de las pruebas de la migración 0027 (caja y cobros). El escenario (medios, cuentas, caja) lo arma el DUEÑO de la base; lo que se
 * prueba va con el rol de la aplicación y su contexto firmado (`SesionDePrueba`), con SQL directo: son las defensas de la base, sin pasar
 * por el módulo. Las sesiones, jornadas y movimientos los crea la aplicación (los disparadores exigen la persona del contexto).
 *
 * Ojo con `xmin`: los disparadores que piden «en esta misma transacción» (cierre de la sesión, foto del cierre) miran el `xmin` de la fila,
 * que dentro de un savepoint es el de la subtransacción. Por eso el cierre y la cabecera se escriben con `directo` (sin savepoint).
 */

export const TIPOS_DE_MEDIO = [
  "EFECTIVO",
  "TARJETA_DEBITO",
  "TARJETA_CREDITO",
  "TRANSFERENCIA",
  "QR",
  "OTRO",
] as const;
export type TipoDeMedio = (typeof TIPOS_DE_MEDIO)[number];

export const HUELLA = "a".repeat(64);
export const AHORA = "2026-11-09T22:00:00Z";
export const DESPUES = "2026-11-10T02:00:00Z";
export const ZONA = "America/Argentina/Buenos_Aires";

export type Escenario = Readonly<{
  m: Mundo;
  medios: Readonly<Record<TipoDeMedio, string>>;
  cuentas: Readonly<{ terminal: string; qr: string; banco: string }>;
  caja: string;
}>;

/** Una clave de idempotencia válida y distinta cada vez. */
export const claveNueva = (): string => randomUUID();

export async function crearEscenario(dueno: pg.Client, m: Mundo): Promise<Escenario> {
  const medios: Partial<Record<TipoDeMedio, string>> = {};
  for (const tipo of TIPOS_DE_MEDIO) {
    const { rows } = await dueno.query<{ id: string }>(
      "insert into medio_de_pago (empresa_id, tipo) values ($1, $2) returning id",
      [m.empresa, tipo],
    );
    medios[tipo] = rows[0]?.id as string;
  }
  const cuenta = async (tipo: string, nombre: string): Promise<string> =>
    (
      await dueno.query<{ id: string }>(
        "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id) values ($1, $2, $3, $4) returning id",
        [m.empresa, tipo, nombre, m.sucursal],
      )
    ).rows[0]?.id as string;
  const terminal = await cuenta("TERMINAL", "Terminal 1");
  const qr = await cuenta("QR", "QR 1");
  const banco = await cuenta("CUENTA_BANCARIA", "Banco 1");
  const caja = await crearCaja(dueno, m, "Caja 1");
  return {
    m,
    medios: medios as Record<TipoDeMedio, string>,
    cuentas: { terminal, qr, banco },
    caja,
  };
}

export async function crearCaja(
  dueno: pg.Client,
  m: Pick<Mundo, "empresa" | "sucursal">,
  nombre: string,
): Promise<string> {
  return (
    await dueno.query<{ id: string }>(
      "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, $3) returning id",
      [m.empresa, m.sucursal, nombre],
    )
  ).rows[0]?.id as string;
}

/** Lanza si el intento falló (con el detalle de la base), y devuelve las filas. */
export function filasDe(r: Intento): Record<string, unknown>[] {
  acepta(r);
  return r.ok ? r.rows : [];
}

export const textoDe = (r: Intento, columna: string): string => {
  const valor = filasDe(r)[0]?.[columna];
  return typeof valor === "string" || typeof valor === "number" || typeof valor === "bigint"
    ? String(valor)
    : "";
};

/** La fecha de negocio que da la base para un instante, con la zona de la empresa y el corte de la sucursal. */
export async function fechaDeNegocioEn(
  s: SesionDePrueba,
  m: Pick<Mundo, "empresa" | "sucursal">,
  instante: string,
): Promise<{ fecha: string; zona: string; corte: string }> {
  const cfg = filasDe(
    await s.intentar(
      `select e.zona_horaria as zona, to_char(su.hora_de_corte, 'HH24:MI:SS') as corte
         from empresa e join sucursal su on su.empresa_id = e.id where e.id = $1 and su.id = $2`,
      [m.empresa, m.sucursal],
    ),
  )[0] as { zona: string; corte: string };
  const fecha = textoDe(
    await s.intentar("select fecha_de_negocio($1::timestamptz, $2, $3::time)::text as f", [
      instante,
      cfg.zona,
      cfg.corte,
    ]),
    "f",
  );
  return { fecha, zona: cfg.zona, corte: cfg.corte };
}

/** Crea (si falta) la jornada de la sucursal y fecha, ABIERTA, como lo hace `cierre.asegurarAbiertaEnTx`. */
export async function asegurarJornada(
  s: SesionDePrueba,
  m: Pick<Mundo, "empresa" | "sucursal">,
  fecha: string,
): Promise<void> {
  acepta(
    await s.intentar(
      `insert into jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio) values ($1, $2, $3)
       on conflict do nothing`,
      [m.empresa, m.sucursal, fecha],
    ),
  );
}

export type SesionAbierta = Readonly<{ sesion: string; fecha: string; fondo: string }>;

/** Abre una sesión (jornada + sesión + fondo inicial) en una caja, como lo haría `abrirSesion`. Lanza si la base rechaza algo. */
export async function abrirSesion(
  s: SesionDePrueba,
  esc: Escenario,
  opciones: { caja?: string; abiertaEn?: string; fondo?: string } = {},
): Promise<SesionAbierta> {
  const abiertaEn = opciones.abiertaEn ?? AHORA;
  const fondo = opciones.fondo ?? "1000.00";
  const { fecha, zona, corte } = await fechaDeNegocioEn(s, esc.m, abiertaEn);
  await asegurarJornada(s, esc.m, fecha);
  const sesion = textoDe(
    await s.intentar(
      `insert into sesion_caja (empresa_id, caja_id, fecha_negocio, hora_de_corte, zona_horaria, abierta_en, abierta_por,
                               clave_idempotencia, huella)
       values ($1, $2, $3, $4::time, $5, $6, $7, $8, $9) returning id`,
      [
        esc.m.empresa,
        opciones.caja ?? esc.caja,
        fecha,
        corte,
        zona,
        abiertaEn,
        esc.m.persona,
        claveNueva(),
        HUELLA,
      ],
    ),
    "id",
  );
  acepta(
    await movimiento(s, esc, sesion, {
      clase: "FONDO_INICIAL",
      medio: "EFECTIVO",
      importe: fondo,
      sinClave: true,
    }),
  );
  return { sesion, fecha, fondo };
}

export type DatosDeMovimiento = Readonly<{
  clase: "FONDO_INICIAL" | "COBRO" | "INGRESO_MANUAL" | "EGRESO_MANUAL" | "AJUSTE" | "ANULACION";
  medio: TipoDeMedio;
  cuenta?: string | null;
  importe: string;
  motivo?: string | null;
  anulaA?: string | null;
  corrigeJornada?: string | null;
  persona?: string;
  sinClave?: boolean;
  registradoEn?: string;
}>;

/** Inserta un movimiento (sin su fila de `cobro` si es un cobro: eso lo agrega `cobrar`). Devuelve el intento con el `id`. */
export function movimiento(
  s: SesionDePrueba,
  esc: Escenario,
  sesion: string,
  d: DatosDeMovimiento,
): Promise<Intento> {
  const conClave = d.sinClave !== true;
  return s.intentar(
    `insert into movimiento_caja (empresa_id, sesion_id, clase, medio_de_pago_id, cuenta_de_cobro_id, importe, motivo, anula_a,
                                  corrige_jornada, registrado_en, registrado_por, clave_idempotencia, huella)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12, $13) returning id`,
    [
      esc.m.empresa,
      sesion,
      d.clase,
      esc.medios[d.medio],
      d.cuenta ?? null,
      d.importe,
      d.motivo ?? null,
      d.anulaA ?? null,
      d.corrigeJornada ?? null,
      d.registradoEn ?? AHORA,
      d.persona ?? esc.m.persona,
      conClave ? claveNueva() : null,
      conClave ? HUELLA : null,
    ],
  );
}

export type DatosDeCobro = Partial<{
  cupon: string | null;
  ultimos4: string | null;
  marca: string | null;
  cuotas: number | null;
  dni: string | null;
}>;

/** La fila de `cobro` de un movimiento COBRO ya insertado. */
export function filaDeCobro(
  s: SesionDePrueba,
  esc: Escenario,
  movimientoId: string,
  origen: { id?: string; orden?: number; tipo?: string } = {},
  datos: DatosDeCobro = {},
): Promise<Intento> {
  return s.intentar(
    `insert into cobro (movimiento_id, empresa_id, origen_tipo, origen_id, origen_orden, cupon, ultimos4, marca_de_tarjeta_id,
                        cuotas, dni)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      movimientoId,
      esc.m.empresa,
      origen.tipo ?? "ventas.cobranza_de_ticket",
      origen.id ?? randomUUID(),
      origen.orden ?? 1,
      datos.cupon ?? null,
      datos.ultimos4 ?? null,
      datos.marca ?? null,
      datos.cuotas ?? null,
      datos.dni ?? null,
    ],
  );
}

/** Un cobro completo (movimiento + fila de cobro). Devuelve el id del movimiento. Lanza si algo se rechaza. */
export async function cobrar(
  s: SesionDePrueba,
  esc: Escenario,
  sesion: string,
  d: {
    medio: TipoDeMedio;
    cuenta?: string | null;
    importe: string;
    origen?: { id?: string; orden?: number };
  },
  datos: DatosDeCobro = {},
): Promise<string> {
  const id = textoDe(
    await movimiento(s, esc, sesion, {
      clase: "COBRO",
      medio: d.medio,
      cuenta: d.cuenta ?? null,
      importe: d.importe,
    }),
    "id",
  );
  acepta(await filaDeCobro(s, esc, id, d.origen, datos));
  return id;
}

export type ConteoDeCierre = Readonly<{
  /** denominación → cantidad */
  billetes?: Readonly<Record<number, number>>;
  monedas?: string;
  /** Los que no son efectivo: «declaro lo que registré» (por defecto) o «conforme» (los que figuran acá). */
  conforme?: boolean;
}>;

/**
 * Cierra la sesión como lo haría `cerrarSesion` (cierre directo): lee el esperado, la pasa a CERRADA y escribe el arqueo con el efectivo
 * contado por billetes y los demás medios declarados igual a lo registrado (o conformes). Sin savepoints (ver el encabezado).
 */
export async function cerrarSesion(
  s: SesionDePrueba,
  esc: Escenario,
  sesion: string,
  conteo: ConteoDeCierre = {},
  cierraEnPedido?: string,
): Promise<void> {
  const esperados = filasDe(
    await s.directo(
      `select medio_de_pago_id as medio, cuenta_de_cobro_id as cuenta, sum(importe)::text as esperado
         from movimiento_caja where empresa_id = $1 and sesion_id = $2 group by 1, 2`,
      [esc.m.empresa, sesion],
    ),
  ) as { medio: string; cuenta: string | null; esperado: string }[];
  // Por defecto, cuatro horas después de abrir (el cierre no puede ser anterior a la apertura).
  const cierraEn =
    cierraEnPedido ??
    textoDe(
      await s.directo(
        `select to_char((abierta_en + interval '4 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as t
           from sesion_caja where id = $1`,
        [sesion],
      ),
      "t",
    );
  acepta(
    await s.directo(
      `update sesion_caja set estado = 'CERRADA', cierre_iniciado_en = $3, cierre_iniciado_por = $4, cerrada_en = $3, cerrada_por = $4
        where empresa_id = $1 and id = $2`,
      [esc.m.empresa, sesion, cierraEn, esc.m.persona],
    ),
  );
  const billetes = conteo.billetes ?? { 1000: 1 };
  const monedas = conteo.monedas ?? "0.00";
  let enBilletes = 0;
  for (const [denominacion, cantidad] of Object.entries(billetes)) {
    enBilletes += Number(denominacion) * cantidad;
    acepta(
      await s.directo(
        "insert into arqueo_billete (empresa_id, sesion_id, denominacion, cantidad) values ($1, $2, $3, $4)",
        [esc.m.empresa, sesion, Number(denominacion), cantidad],
      ),
    );
  }
  const contadoEfectivo = (enBilletes + Number(monedas)).toFixed(2);
  const lineas = esperados.some((e) => e.medio === esc.medios.EFECTIVO && e.cuenta === null)
    ? esperados
    : [...esperados, { medio: esc.medios.EFECTIVO, cuenta: null, esperado: "0.00" }];
  for (const l of lineas) {
    const esEfectivo = l.medio === esc.medios.EFECTIVO;
    const conforme = !esEfectivo && conteo.conforme === true;
    acepta(
      await s.directo(
        `insert into arqueo_caja (empresa_id, sesion_id, medio_de_pago_id, cuenta_de_cobro_id, esperado, contado, contado_monedas,
                                  conforme, conforme_por, conforme_en)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          esc.m.empresa,
          sesion,
          l.medio,
          l.cuenta,
          l.esperado,
          conforme ? null : esEfectivo ? contadoEfectivo : l.esperado,
          esEfectivo ? monedas : null,
          conforme,
          conforme ? esc.m.persona : null,
          conforme ? cierraEn : null,
        ],
      ),
    );
  }
}
