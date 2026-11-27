import { errorDeCodigo } from "../../../../../../../../../../../src/capacidades/experiencia/respuesta";
import { pantallaDeOperacion } from "../../../../../../../../../pantallas/operacion";
import { cargarLoDeCargarUnaNota } from "../../../../../../../../../servidor/notas";
import { ErrorDelDetalle } from "../../../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeCargarNota } from "../../../../../../../../../ui/plantillas/compras/notas/FormularioDeCargarNota.cliente";
import { claseDeLaDireccion } from "../../../../../../../../../ui/plantillas/compras/notas/modelo-de-notas";
import { textosDeNotas } from "../../../../../../../../../ui/plantillas/compras/notas/textos-de-notas";
import {
  registrarNotaDeCreditoAccion,
  registrarNotaDeDebitoAccion,
} from "../../../../../../acciones-de-notas";

type PropsDePagina = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>;

// `/compras/facturas/[id]/notas/nueva?clase=credito|debito`: «Cargar una nota del proveedor» (maqueta `servicios-y-bienes-de-uso.html`, pantalla 10). El id y la clase son lo único que viene de la dirección; la clase es una
// de dos palabras fijas (cualquier otra cosa no abre la pantalla). La empresa, la persona, el proveedor y el alcance los decide el servidor. Nace cerrada: sin el permiso de registrar esa clase no hay formulario (y el servidor
// lo vuelve a verificar al guardar). «Todavía se puede acreditar» es el neto que lee el servidor al abrir; lo revalida al guardar. La clave del envío la genera la pantalla por intento.
export default async function PaginaDeCargarUnaNota({ params, searchParams }: PropsDePagina) {
  const { id } = await params;
  const clase = claseDeLaDireccion((await searchParams)["clase"]);
  return pantallaDeOperacion({ titulo: "compras.notas.cargar_titulo" }, async ({ contexto }) => {
    if (clase === null)
      return <ErrorDelDetalle error={errorDeCodigo("COMPRAS_ACCION_NO_PERMITIDA")} />;
    const previo = await cargarLoDeCargarUnaNota(
      contexto,
      clase === "credito" ? "CREDITO" : "DEBITO",
      id,
    );
    if (!previo.ok) return <ErrorDelDetalle error={previo.error} />;
    return (
      <FormularioDeCargarNota
        clase={clase}
        facturaId={id}
        textos={textosDeNotas()}
        todaviaSePuedeAcreditar={clase === "credito" ? previo.dato.netoAPagar : null}
        registrar={clase === "credito" ? registrarNotaDeCreditoAccion : registrarNotaDeDebitoAccion}
      />
    );
  });
}
