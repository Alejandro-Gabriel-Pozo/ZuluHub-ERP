import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { RolDeRenglon, SalidaDeLinea, TipoDeEnvio } from "../dominio/envio";

export type Envio = Readonly<{
  id: string;
  sucursalId: string;
  cuentaId: string;
  numero: number;
  tipo: TipoDeEnvio;
  rotulo: string;
  enviadoPor: PersonaId;
  enviadoEn: Date;
  /** `YYYY-MM-DD`, la que fijó la base con el corte de la sucursal. */
  fechaNegocio: string;
  clave: string;
  huella: string;
}>;

export type AltaDeEnvio = Readonly<{
  id: string;
  sucursalId: string;
  cuentaId: string;
  numero: number;
  tipo: TipoDeEnvio;
  rotulo: string;
  enviadoPor: PersonaId;
  enviadoEn: Date;
  clave: string;
  huella: string;
}>;

export type Renglon = Readonly<{
  orden: number;
  lineaId: string;
  cantidad: string;
  rol: RolDeRenglon;
  nombreDeCocina: string;
  detalleDeCocina: readonly string[];
}>;

/** El estado de comanda de una línea (`linea_de_comanda`) con el número del envío en que salió. */
export type FilaDeComanda = Readonly<{
  lineaId: string;
  salida: SalidaDeLinea;
  envioId: string | null;
  numeroDeEnvio: number | null;
}>;

export type Aviso = Readonly<{
  id: string;
  cuentaId: string;
  lineaOrigenId: string;
  envioId: string;
  cantidad: string;
  quedan: string;
  motivo: string;
  nombreDeCocina: string;
  detalleDeCocina: readonly string[];
  rotulo: string;
  anuladoPor: PersonaId;
  anuladoEn: Date;
}>;

export type ResumenDeComandas = Readonly<{ paraEnviar: number; enEspera: number; envios: number }>;

/**
 * Persistencia de los envíos, el estado de comanda de cada línea y los avisos de anulación (0038, E7 §3.2). Todo corre dentro de la transacción del
 * caso de uso, filtra SIEMPRE por la empresa (y la RLS lo repite) y no usa caché.
 */
export interface RepositorioDeEnvios {
  /**
   * El siguiente número de envío de la cuenta: `INSERT … ON CONFLICT DO NOTHING` y `UPDATE … SET ultimo = ultimo + 1 RETURNING`. La fila queda
   * bloqueada hasta el fin de la transacción: N envíos a la vez en una cuenta se serializan sin huecos.
   */
  siguienteNumero(empresa: EmpresaId, cuentaId: string): Promise<number>;
  insertarEnvio(empresa: EmpresaId, alta: AltaDeEnvio): Promise<Envio>;
  envioPorId(empresa: EmpresaId, id: string): Promise<Envio | null>;
  envioPorClave(empresa: EmpresaId, clave: string): Promise<Envio | null>;
  enviosDeCuenta(empresa: EmpresaId, cuentaId: string): Promise<Envio[]>;
  insertarRenglones(
    empresa: EmpresaId,
    envioId: string,
    renglones: readonly Renglon[],
  ): Promise<void>;
  renglonesDeEnvio(empresa: EmpresaId, envioId: string): Promise<Renglon[]>;
  /** El renglón que SACÓ a la línea (rol `SALE`) y el envío donde salió: la foto de lo que se mandó a cocina. */
  renglonDeSalida(
    empresa: EmpresaId,
    lineaId: string,
  ): Promise<Readonly<{ envio: Envio; renglon: Renglon }> | null>;
  /** Crea las filas que falten de las líneas dadas (sin enviar, `AHORA`): una línea vigente sin fila cuenta como para enviar. */
  asegurarFilas(empresa: EmpresaId, cuentaId: string, lineaIds: readonly string[]): Promise<void>;
  filaDeComanda(empresa: EmpresaId, lineaId: string): Promise<FilaDeComanda | null>;
  /** Las filas de comanda de una cuenta (todas sus líneas, vigentes o no). */
  filasDeCuenta(empresa: EmpresaId, cuentaId: string): Promise<FilaDeComanda[]>;
  /** `UPDATE … SET envio_id = … WHERE envio_id IS NULL` de esas líneas: devuelve las que de verdad quedaron en el envío (el árbitro: cada línea sale en UNO). */
  tomarParaEnviar(
    empresa: EmpresaId,
    envioId: string,
    lineaIds: readonly string[],
  ): Promise<string[]>;
  /** Cambia «sale ahora / después» solo mientras no se envió (`WHERE envio_id IS NULL`); `false` si ya salió. */
  cambiarSalida(empresa: EmpresaId, lineaId: string, salida: SalidaDeLinea): Promise<boolean>;
  /** La fila de la línea nueva: conserva `salida` y `envio_id` de la origen (la copia de una línea ya enviada). */
  insertarFila(
    empresa: EmpresaId,
    fila: Readonly<{
      lineaId: string;
      cuentaId: string;
      salida: SalidaDeLinea;
      envioId: string | null;
    }>,
  ): Promise<void>;
  resumenPorCuentas(
    empresa: EmpresaId,
    cuentaIds: readonly string[],
  ): Promise<Map<string, ResumenDeComandas>>;
  insertarAviso(empresa: EmpresaId, aviso: Aviso): Promise<boolean>;
  avisoPorId(empresa: EmpresaId, id: string): Promise<Aviso | null>;
  avisoPorLinea(empresa: EmpresaId, lineaOrigenId: string): Promise<Aviso | null>;
}
