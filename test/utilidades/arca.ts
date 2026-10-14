import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  PedidoDeTransporte,
  RespuestaDeTransporte,
  Transporte,
} from "../../src/adaptadores/arca/tipos";
import type { EmisorId, EmpresaId } from "../../src/primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import type {
  AlmacenDeTickets,
  ErrorDeAlmacenDeTickets,
  ServicioDeArca,
  TicketDeAcceso,
} from "../../src/puertos/almacen-de-tickets";
import type {
  AmbienteDeArca,
  CredencialesDeEmisor,
  CredencialesDescifradas,
  ErrorDeCredenciales,
} from "../../src/puertos/credenciales-de-emisor";

/**
 * Ayudas de las pruebas del adaptador real de ARCA (tramo F8): las grabaciones reales de homologación, un
 * transporte falso que las sirve e implementaciones en memoria de los puertos de F7 (credenciales y tickets).
 * La credencial de prueba (con pkijs, más pesada) está aparte, en `arca-credencial.ts`.
 *
 * Las grabaciones son de la homologación REAL del 2026-10-14 (espía F0, dos corridas con el CUIT de prueba del
 * dueño), ya saneadas (el `Token`, el `Sign` y el CMS figuran como `[OCULTO]`) y las copió el espía de
 * `fiscal/f0-espia`. Son datos NO CONFIABLES: se leen como texto y se pasan al lector; nada de ellas se ejecuta.
 */

const CARPETA = fileURLToPath(new URL("./arca-grabaciones/", import.meta.url));

/** El archivo grabado `NNN-...` de una corrida: el pedido (`pedido`) o la respuesta (`respuesta`). */
export function grabacion(corrida: 1 | 2, numero: string, tipo: "pedido" | "respuesta"): string {
  const carpeta = `${CARPETA}corrida${corrida}/`;
  const archivo = readdirSync(carpeta).find(
    (a) => a.startsWith(`${numero}-`) && a.includes(`-${tipo}`),
  );
  if (archivo === undefined) {
    throw new Error(`no hay grabación ${numero} (${tipo}) en la corrida ${corrida}`);
  }
  return readFileSync(`${carpeta}${archivo}`, "utf8");
}

/** Una respuesta HTTP completa del transporte con ese cuerpo. */
export const respuestaHttp = (cuerpo: string, estadoHttp = 200): RespuestaDeTransporte => ({
  tipo: "RESPUESTA",
  estadoHttp,
  cuerpo,
});

// ---------------------------------------------------------------------------------------------------------------
// Secretos de juguete (se arman al vuelo: son largos pero de baja entropía a propósito)
// ---------------------------------------------------------------------------------------------------------------

/** Un token y una firma que NUNCA deben aparecer en una salida del adaptador. */
export const TOKEN_DE_PRUEBA = `TOKEN${"Qk3".repeat(40)}`;
export const FIRMA_DE_PRUEBA = `FIRMA${"Zx7".repeat(40)}`;

/** La respuesta de `loginCms` de la grabación, con este token, esta firma y este vencimiento (ISO con huso). */
export function respuestaDeLoginCms(
  opciones: Readonly<{ token?: string; sign?: string; vence?: string }> = {},
): string {
  const original = grabacion(1, "002", "respuesta");
  const token = opciones.token ?? TOKEN_DE_PRUEBA;
  const sign = opciones.sign ?? FIRMA_DE_PRUEBA;
  let k = 0;
  const conSecretos = original.replace(/\[OCULTO\]/g, () => (k++ === 0 ? token : sign));
  return opciones.vence === undefined
    ? conSecretos
    : conSecretos.replace(
        /(expirationTime&gt;)[^&]*(&lt;)/,
        (_todo, a: string, b: string) => `${a}${opciones.vence}${b}`,
      );
}

// ---------------------------------------------------------------------------------------------------------------
// Transporte falso
// ---------------------------------------------------------------------------------------------------------------

type Guion =
  | RespuestaDeTransporte
  | ((pedido: PedidoDeTransporte) => RespuestaDeTransporte | Promise<RespuestaDeTransporte>);

/**
 * Un transporte que no sale a la red: responde según lo programado para cada operación (la última parte de la
 * cabecera `SOAPAction` o `loginCms`) y guarda cada pedido que recibió, en orden. Una operación sin guion es un
 * defecto de la prueba y lanza.
 */
export class TransporteFalso {
  readonly pedidos: PedidoDeTransporte[] = [];
  private readonly guiones = new Map<string, Guion[]>();

  /** Los próximos pedidos de esa operación se responden así, en orden; el último guion se repite. */
  programar(operacion: string, ...respuestas: Guion[]): this {
    this.guiones.set(operacion, respuestas);
    return this;
  }

  /** La operación de un pedido: `FECAESolicitar`, `FECompConsultar`... o `loginCms`. */
  static operacionDe(pedido: PedidoDeTransporte): string {
    return pedido.accionSoap === ""
      ? "loginCms"
      : pedido.accionSoap.slice(pedido.accionSoap.lastIndexOf("/") + 1);
  }

  /** Cuántas veces se pidió esa operación. */
  veces(operacion: string): number {
    return this.pedidos.filter((p) => TransporteFalso.operacionDe(p) === operacion).length;
  }

  readonly transporte: Transporte = async (pedido) => {
    this.pedidos.push(pedido);
    const operacion = TransporteFalso.operacionDe(pedido);
    const cola = this.guiones.get(operacion);
    if (cola === undefined || cola.length === 0) {
      throw new Error(`la prueba no programó la operación ${operacion}`);
    }
    const guion = cola.length > 1 ? cola.shift() : cola[0];
    if (guion === undefined) throw new Error("sin guion");
    return typeof guion === "function" ? guion(pedido) : guion;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Los puertos de F7 en memoria
// ---------------------------------------------------------------------------------------------------------------

/**
 * Credenciales en memoria (puerto de F7): una sola para todos los (emisor, ambiente), `null` para «sin
 * certificado vigente» o un error de credenciales. Cuenta las veces que se pidieron.
 */
export class CredencialesEnMemoria implements CredencialesDeEmisor {
  pedidas = 0;
  constructor(private credencial: CredencialesDescifradas | ErrorDeCredenciales | null) {}
  /** Devuelve lo mismo para cualquier (empresa, emisor, ambiente); solo cuenta las veces. */
  obtener(): Promise<Resultado<CredencialesDescifradas, ErrorDeCredenciales>> {
    this.pedidas += 1;
    if (this.credencial === null) return Promise.resolve(err("SIN_CERTIFICADO_VIGENTE"));
    if (typeof this.credencial === "string" || "tipo" in this.credencial) {
      return Promise.resolve(err(this.credencial));
    }
    return Promise.resolve(ok(this.credencial));
  }
}

/** Una lectura programada: un ticket, ninguno (`null`) o un error del almacén. */
type Lectura = TicketDeAcceso | null | Readonly<{ error: ErrorDeAlmacenDeTickets }>;

/** El almacén de tickets en memoria (puerto de F7), con el orden de lo que se leyó y se guardó. */
export class AlmacenDeTicketsEnMemoria implements AlmacenDeTickets {
  guardados: TicketDeAcceso[] = [];
  lecturas = 0;
  /** Qué devuelve `leer` en cada lectura, en orden (el último se repite); por defecto lo último guardado. */
  private guion: Lectura[] | null = null;
  /** `guardar` lanza una excepción (con una cadena de conexión adentro). */
  fallarAlGuardar = false;
  /** `guardar` devuelve este error. */
  errorAlGuardar: ErrorDeAlmacenDeTickets | null = null;
  private actual: TicketDeAcceso | null;

  constructor(inicial: TicketDeAcceso | null = null) {
    this.actual = inicial;
  }

  /** Las próximas lecturas devuelven esto, en orden (la última se repite). */
  programarLecturas(...lecturas: Lectura[]): void {
    this.guion = lecturas;
  }

  leer(): Promise<Resultado<TicketDeAcceso | null, ErrorDeAlmacenDeTickets>> {
    this.lecturas += 1;
    const lectura: Lectura =
      this.guion === null
        ? this.actual
        : ((this.guion.length > 1 ? this.guion.shift() : this.guion[0]) ?? null);
    if (lectura !== null && "error" in lectura) return Promise.resolve(err(lectura.error));
    return Promise.resolve(ok(lectura));
  }

  guardar(
    ...argumentos: [EmpresaId, EmisorId, AmbienteDeArca, ServicioDeArca, TicketDeAcceso]
  ): Promise<Resultado<null, ErrorDeAlmacenDeTickets>> {
    const ticket = argumentos[4];
    if (this.fallarAlGuardar) {
      return Promise.reject(new Error("falla de la base con postgres://secreto"));
    }
    if (this.errorAlGuardar !== null) return Promise.resolve(err(this.errorAlGuardar));
    this.guardados.push(ticket);
    this.actual = ticket;
    return Promise.resolve(ok(null));
  }
}
