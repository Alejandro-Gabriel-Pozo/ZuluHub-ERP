import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  armarPedidoDeCertificado,
  numeroDeSerieDeCuit,
  type EntradaDePedidoDeCertificado,
  type ErrorDePedidoDeCertificado,
  type PedidoDeCertificadoValido,
} from "../dominio/certificado-pedido";
import type { CertificadoId } from "../dominio/identificadores";
import {
  dondeSeGuardaLaClave,
  type CertificadoGuardado,
} from "../persistencia/repositorio-de-certificados";
import { traducirErroresDeFiscal } from "../persistencia/traducir";
import { empresaOpera } from "./comun";
import type { DependenciasDeCertificados } from "./contrato-de-certificados";
import { DECLARACIONES_DE_CERTIFICADOS } from "./declaraciones-de-certificados";

/**
 * `generarPedidoDeCertificado` (spec H7 facturación §B.4 y §B.6, tramo F7): ZuluHub genera la clave privada y el
 * pedido (CSR) dentro del servidor; la clave se guarda CIFRADA, atada a su fila, y nunca sale ni se muestra: lo único
 * que vuelve es el pedido en PEM, que el gerente sube a ARCA con su clave fiscal. Cada cliente es dueño de su propio
 * certificado (decisión del dueño 2026-10-14): el titular tiene que ser el CUIT del emisor.
 *
 * Una transacción SERIALIZABLE con el guard primero: 1. guard `certificados.gestionar`. 2. La empresa opera.
 * 3. Forma del pedido. 4. Repetición: el `id` (uuid que genera la pantalla) ES la clave de idempotencia; con el mismo
 * pedido (emisor, ambiente, alias y titular) devuelve el que existe (`yaExistia`) SIN generar otra clave; con otro
 * pedido, `CLAVE_REUTILIZADA`. 5. El emisor existe, está activo y su CUIT es el del titular. 6. Se genera el par, se
 * cifra la clave con su fila, se guarda `PEDIDO_GENERADO`. 7. Auditoría `CERTIFICADO_PEDIDO_GENERADO` en la misma
 * transacción: el hecho (quién, cuándo, alias, emisor, ambiente), nunca la clave ni su cifrado.
 *
 * Dos pedidos simultáneos con el mismo `id`: la base deja pasar uno; el otro repite, lo encuentra y lo devuelve (la
 * clave que había generado se descarta sin guardarse). Dos pedidos con el mismo alias y distinto `id` son dos pedidos
 * (cada uno con su clave): que ARCA acepte o no un alias repetido es NO VERIFICADO y lo dirá ella al subir el pedido.
 * El pedido no guarda la organización aparte (solo vive en el CSR): repetir con otra organización devuelve el pedido
 * que ya existe.
 */

export type EntradaDeGenerarPedido = EntradaDePedidoDeCertificado;

export type SalidaDeGenerarPedido = Readonly<{
  certificadoId: CertificadoId;
  /** El pedido (CSR) en PEM: es público, es lo que se sube a ARCA. */
  pedidoPem: string;
  /** `true`: el mismo pedido ya existía; no se generó otra clave ni se escribió nada. */
  yaExistia: boolean;
}>;

export type ErrorPropioAlGenerarPedido =
  | ErrorDePedidoDeCertificado
  | "EMISOR_NO_ENCONTRADO"
  | "EMISOR_INACTIVO"
  | "TITULAR_DISTINTO"
  | "CLAVE_REUTILIZADA";

export type ErrorAlGenerarPedido =
  ErrorPropioAlGenerarPedido | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Lo que la base puede rechazar al dar de alta y que es parte del contrato de este caso. */
const ADMITIDOS = ["EMISOR_NO_ENCONTRADO", "ALIAS_INVALIDO", "CUIT_INVALIDO"] as const;

const esElMismoPedido = (guardado: CertificadoGuardado, pedido: PedidoDeCertificadoValido) =>
  guardado.emisorId === pedido.emisorId &&
  guardado.ambiente === pedido.ambiente &&
  guardado.alias === pedido.alias &&
  guardado.cuitTitular === pedido.cuitTitular;

const repeticion = (
  guardado: CertificadoGuardado,
  pedido: PedidoDeCertificadoValido,
): Resultado<SalidaDeGenerarPedido, "CLAVE_REUTILIZADA"> =>
  esElMismoPedido(guardado, pedido)
    ? ok({ certificadoId: guardado.id, pedidoPem: guardado.pedidoPem, yaExistia: true })
    : err("CLAVE_REUTILIZADA");

export function armarGenerarPedidoDeCertificado({
  transacciones,
  reglas,
  cifrador,
  generador,
}: DependenciasDeCertificados) {
  return async function generarPedidoDeCertificado(
    contexto: ContextoOperativo,
    entrada: EntradaDeGenerarPedido,
  ): Promise<Resultado<SalidaDeGenerarPedido, ErrorAlGenerarPedido>> {
    const { personaId, empresaId } = contexto;
    if (personaId === null) {
      throw new RangeError(
        "generar el pedido de un certificado exige una persona: un trabajo de sistema no lo hace",
      );
    }
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeGenerarPedido,
          ErrorPropioAlGenerarPedido | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CERTIFICADOS.generarPedidoDeCertificado.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return opera;
        const armado = armarPedidoDeCertificado(entrada);
        if (!armado.ok) return armado;
        const pedido = armado.valor;

        // La repetición va antes de mirar al emisor: repetir un pedido que ya salió devuelve lo mismo aunque el
        // emisor se haya dado de baja después.
        const previo = await tx.certificados.obtener(empresaId, pedido.id);
        if (previo !== null) return repeticion(previo, pedido);

        const emisor = await tx.emisores.obtener(empresaId, pedido.emisorId);
        if (emisor === null) return err("EMISOR_NO_ENCONTRADO");
        if (!emisor.activo) return err("EMISOR_INACTIVO");
        if (emisor.cuit !== pedido.cuitTitular) return err("TITULAR_DISTINTO");

        const generada = await generador.generar({
          alias: pedido.alias,
          organizacion: pedido.organizacion,
          numeroDeSerie: numeroDeSerieDeCuit(pedido.cuitTitular),
        });
        const alta = await tx.certificados.crearPedido({
          id: pedido.id,
          empresaId,
          emisorId: pedido.emisorId,
          ambiente: pedido.ambiente,
          alias: pedido.alias,
          cuitTitular: pedido.cuitTitular,
          pedidoPem: generada.pedidoPem,
          clave: cifrador.cifrar(generada.clavePrivada, dondeSeGuardaLaClave(empresaId, pedido.id)),
          creadoPor: personaId,
        });
        if (!alta.ok || !alta.valor.creado) {
          // Otro pedido con este `id` ganó mientras tanto: es la repetición (la clave generada se descarta).
          const ganador = await tx.certificados.obtener(empresaId, pedido.id);
          return ganador === null ? err("CLAVE_REUTILIZADA") : repeticion(ganador, pedido);
        }
        const creado = alta.valor.valor;
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: personaId,
          accion: "CERTIFICADO_PEDIDO_GENERADO",
          entidad: "certificado_arca",
          entidadId: creado.id,
          despues: {
            estado: creado.estado,
            emisorId: creado.emisorId,
            ambiente: creado.ambiente,
            alias: creado.alias,
            cuitTitular: creado.cuitTitular,
          },
        });
        return ok({ certificadoId: creado.id, pedidoPem: creado.pedidoPem, yaExistia: false });
      },
    );
    return traducirErroresDeFiscal(resultado, ADMITIDOS);
  };
}
