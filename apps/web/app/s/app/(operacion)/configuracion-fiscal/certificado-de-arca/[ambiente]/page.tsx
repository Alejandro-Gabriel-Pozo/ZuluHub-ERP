import { notFound } from "next/navigation";
import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { conTitulo, pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { aCertificadoParaMostrar } from "../../../../../../../pantallas/certificado";
import { cargarLosCertificados } from "../../../../../../../servidor/certificado-de-arca";
import { AsistenteDeCertificado } from "../../../../../../../ui/plantillas/configuracion-fiscal/AsistenteDeCertificado.cliente";
import { RUTAS_DE_CONFIGURACION } from "../../../../../../../ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import { ConMigas } from "../../../../../../../ui/plantillas/configuracion-fiscal/MigasDeConfiguracion";
import {
  ambienteDelSegmento,
  armarElAmbiente,
  nombreDelAmbiente,
} from "../../../../../../../ui/plantillas/configuracion-fiscal/modelo-de-certificado";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import {
  cargarCertificadoAccion,
  generarPedidoDeCertificadoAccion,
} from "../../../../acciones-de-certificado";

type PropsDePagina = Readonly<{ params: Promise<{ ambiente: string }> }>;

const MIGAS = [
  { texto: texto({}, "fiscal.pantalla.config_titulo"), href: RUTAS_DE_CONFIGURACION.lista },
  {
    texto: texto({}, "fiscal.pantalla.config_fila_certificado"),
    href: RUTAS_DE_CONFIGURACION.certificado,
  },
];

// `/configuracion-fiscal/certificado-de-arca/[ambiente]`: el asistente de un ambiente (`pruebas` o `produccion`). El ambiente de la dirección
// es lo único que viene del navegador; el emisor y el estado salen del servidor. Un segmento que no es un ambiente es «no encontrado» de Next.
export default async function PaginaDeUnCertificado({ params }: PropsDePagina) {
  const { ambiente: segmento } = await params;
  return pantallaDeOperacion(
    { titulo: "fiscal.pantalla.config_fila_certificado" },
    async ({ contexto }) => {
      const ambiente = ambienteDelSegmento(segmento);
      if (ambiente === null) notFound();
      const estado = await cargarLosCertificados(contexto);
      if (!estado.ok) return <ErrorDelDetalle error={estado.error} />;
      const delAmbiente = estado.dato.certificados.find((c) => c.ambiente === ambiente);
      const certificado = aCertificadoParaMostrar(
        delAmbiente ?? { ambiente, situacion: "FALTA_CARGAR" },
      );
      return conTitulo(
        nombreDelAmbiente(ambiente),
        <ConMigas tramos={MIGAS}>
          <AsistenteDeCertificado
            emisorId={estado.dato.emisorId}
            ambiente={ambiente}
            arranque={armarElAmbiente(certificado)}
            generar={generarPedidoDeCertificadoAccion}
            cargar={cargarCertificadoAccion}
            rutaALaLista={RUTAS_DE_CONFIGURACION.certificado}
          />
        </ConMigas>,
      );
    },
  );
}
