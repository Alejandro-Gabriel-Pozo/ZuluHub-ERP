import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  evaluarCertificado,
  extraerCertificadoPem,
  type ErrorAlCargarCertificado,
} from "../dominio/certificado-carga";
import type { CertificadoId } from "../dominio/identificadores";
import { dondeSeGuardaLaClave } from "../persistencia/repositorio-de-certificados";
import { traducirErroresDeFiscal } from "../persistencia/traducir";
import { empresaOpera } from "./comun";
import type { DependenciasDeCertificados } from "./contrato-de-certificados";
import { DECLARACIONES_DE_CERTIFICADOS } from "./declaraciones-de-certificados";

/**
 * `cargarCertificado` (spec H7 facturación §B.4 y §B.6.2, tramo F7): el gerente pega el certificado que ARCA le
 * devolvió contra el pedido que generó Pedernal, y pasa de `PEDIDO_GENERADO` a `VIGENTE`.
 *
 * Una transacción SERIALIZABLE con el guard primero: 1. guard `certificados.gestionar`. 2. La empresa opera.
 * 3. El texto es UN certificado legible (una clave privada pegada por error es ilegible y nunca se guarda ni se
 * repite). 4. El pedido existe. 5. Repetición: el mismo certificado (por su huella) en un pedido ya cargado
 * devuelve lo mismo (`yaEstaba`) sin escribir; otro certificado, o un pedido descartado, `PEDIDO_NO_PENDIENTE`.
 * 6. Las validaciones (§B.6.2), en este orden: corresponde a la clave que generó Pedernal (se descifra SOLO en
 * memoria y atada a su fila), el `serialNumber` del sujeto es el CUIT del TITULAR declarado al generar el pedido
 * (`NO_CORRESPONDE_AL_TITULAR`; D-42, 2026-10-29: el titular es la persona física que sacó el certificado y puede ser
 * distinta del emisor; el titular quedó guardado en el pedido y viaja en el `serialNumber` de su CSR), la cadena cierra
 * contra la del mismo ambiente, no está vencido. 7. Si el emisor ya tenía uno `VIGENTE` en ese ambiente, queda
 * `REEMPLAZADO` en la misma transacción (`reemplazoA`). 8. Auditoría `CERTIFICADO_CARGADO` (y
 * `CERTIFICADO_REEMPLAZADO`): el hecho, nunca el contenido.
 *
 * Que el titular esté autorizado a actuar por la empresa NO se puede verificar acá (D-42): el certificado nace con
 * `autorizacion_verificada_en` vacío («autorización sin verificar») y lo anota la primera llamada exitosa a ARCA
 * (`crearVerificacionDeAutorizacion`).
 *
 * Dos cargas a la vez del mismo certificado, o de certificados distintos para el mismo (emisor, ambiente), se
 * serializan (la base y el repositorio): al final hay exactamente un `VIGENTE`, y la repetición devuelve `yaEstaba`.
 * La salida de una repetición lleva `reemplazoA: null`: ese vínculo queda en la auditoría de la primera carga.
 */

export type EntradaDeCargarCertificado = Readonly<{
  certificadoId: CertificadoId;
  /** Lo que pegó el gerente: el certificado en PEM. */
  certificadoPem: string;
}>;

export type SalidaDeCargarCertificado = Readonly<{
  vence: Date;
  /** El certificado vigente que este reemplazó; `null` si no había. */
  reemplazoA: CertificadoId | null;
  /** `true`: ese mismo certificado ya estaba cargado; no se escribió nada. */
  yaEstaba: boolean;
}>;

export type ErrorPropioAlCargarCertificado =
  | ErrorAlCargarCertificado
  | "CERTIFICADO_NO_ENCONTRADO"
  | "PEDIDO_NO_PENDIENTE"
  /** La clave guardada no se descifra (clave maestra equivocada o fila alterada): no es culpa de lo pegado. */
  | "CLAVE_ILEGIBLE"
  | "CERTIFICADO_YA_CARGADO";

export type ErrorAlCargarCertificadoDeUso =
  ErrorPropioAlCargarCertificado | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Lo que la base puede rechazar al activar y que es parte del contrato de este caso. */
const ADMITIDOS = ["CERTIFICADO_YA_CARGADO", "CERTIFICADO_ILEGIBLE"] as const;

export function armarCargarCertificado({
  transacciones,
  reglas,
  cifrador,
  lector,
}: DependenciasDeCertificados) {
  return async function cargarCertificado(
    contexto: ContextoOperativo,
    entrada: EntradaDeCargarCertificado,
  ): Promise<Resultado<SalidaDeCargarCertificado, ErrorAlCargarCertificadoDeUso>> {
    const { personaId, empresaId, ahora } = contexto;
    if (personaId === null) {
      throw new RangeError(
        "cargar un certificado exige una persona: un trabajo de sistema no lo hace",
      );
    }
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeCargarCertificado,
          ErrorPropioAlCargarCertificado | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CERTIFICADOS.cargarCertificado.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return opera;
        const pem = extraerCertificadoPem(entrada.certificadoPem);
        if (!pem.ok) return pem;
        const pedido = await tx.certificados.obtener(empresaId, entrada.certificadoId);
        if (pedido === null) return err("CERTIFICADO_NO_ENCONTRADO");
        const leido = lector.leer(pem.valor);
        if (leido === null) return err("CERTIFICADO_ILEGIBLE");

        if (pedido.estado !== "PEDIDO_GENERADO") {
          const yaCargado = pedido.estado === "VIGENTE" || pedido.estado === "REEMPLAZADO";
          if (yaCargado && pedido.huellaSha256 === leido.huellaSha256 && pedido.venceEn !== null) {
            return ok({ vence: pedido.venceEn, reemplazoA: null, yaEstaba: true });
          }
          return err("PEDIDO_NO_PENDIENTE");
        }

        const guardada = await tx.certificados.obtenerClave(empresaId, pedido.id);
        if (guardada === null) throw new Error("el pedido existe pero su clave no es visible");
        const clave = cifrador.descifrar(guardada, dondeSeGuardaLaClave(empresaId, pedido.id));
        if (clave === null) return err("CLAVE_ILEGIBLE");

        const evaluado = evaluarCertificado(
          pedido.cuitTitular,
          {
            correspondeALaClave: lector.correspondeALaClave(pem.valor, clave),
            numeroDeSerieDelSujeto: leido.numeroDeSerieDelSujeto,
            cadenaCierra: lector.cadenaCierra(pem.valor, pedido.ambiente, ahora),
            noDespues: leido.noDespues,
          },
          ahora,
        );
        if (!evaluado.ok) return evaluado;

        const activacion = await tx.certificados.activar(empresaId, pedido.id, pedido.version, {
          certificadoPem: pem.valor,
          huellaSha256: leido.huellaSha256,
          venceEn: evaluado.valor.vence,
        });
        if (activacion === null) {
          throw new Error("el pedido de certificado cambió dentro de la transacción");
        }
        const { certificado, reemplazado } = activacion;
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: personaId,
          accion: "CERTIFICADO_CARGADO",
          entidad: "certificado_arca",
          entidadId: certificado.id,
          antes: { estado: pedido.estado },
          despues: {
            estado: certificado.estado,
            alias: certificado.alias,
            ambiente: certificado.ambiente,
            vence: evaluado.valor.vence.toISOString(),
            huella: leido.huellaSha256,
          },
        });
        if (reemplazado !== null) {
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: personaId,
            accion: "CERTIFICADO_REEMPLAZADO",
            entidad: "certificado_arca",
            entidadId: reemplazado.id,
            antes: { estado: "VIGENTE" },
            despues: { estado: "REEMPLAZADO", reemplazadoPor: certificado.id },
          });
        }
        return ok({
          vence: evaluado.valor.vence,
          reemplazoA: reemplazado?.id ?? null,
          yaEstaba: false,
        });
      },
    );
    return traducirErroresDeFiscal(resultado, ADMITIDOS);
  };
}
