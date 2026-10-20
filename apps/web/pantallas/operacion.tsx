import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import type { ClaveDeTexto } from "../../../src/capacidades/vocabulario/catalogo";
import { texto } from "../../../src/capacidades/vocabulario/vocabulario";
import { empresaDelPedido } from "../servidor/sesion";
import { destinosDeModulos } from "../servidor/modulos";
import { ArmazonDeOperacion, type DestinoActual } from "../ui/plantillas/sesion/ArmazonDeOperacion";
import type { EmpresaParaMostrar } from "../ui/plantillas/sesion/textos-de-empresa";
import { PantallaDeErrorDeEntrada } from "./errores";

export type DatosDeLaEmpresaActiva = Readonly<{
  empresa: EmpresaParaMostrar;
  /** Para llamar a los casos de uso y consultas de la empresa. Solo existe en el servidor. */
  contexto: ContextoOperativo;
}>;

/**
 * Una pantalla del mostrador: resuelve sesión, marca del host y empresa (con la cookie `pd_empresa` validada),
 * y si todo está bien la pinta dentro del armazón de operación. Si no hay empresa elegida, manda a elegirla; si
 * la cookie es de otra marca (o de una empresa que ya no es de la persona), «sin permiso». CADA página lo llama
 * (no solo el layout): al navegar de una página a otra Next no vuelve a correr el layout.
 */
export async function pantallaDeOperacion(
  opciones: Readonly<{ titulo: ClaveDeTexto; actual: DestinoActual }>,
  contenido: (datos: DatosDeLaEmpresaActiva) => ReactNode | Promise<ReactNode>,
): Promise<ReactNode> {
  const { puerta, entrada } = await empresaDelPedido();
  if (!entrada.ok) return <PantallaDeErrorDeEntrada error={entrada.error} />;
  if (entrada.dato.tipo !== "ENTRA") redirect("/empresa");
  const { empresa, contexto } = entrada.dato;
  return (
    <ArmazonDeOperacion
      titulo={texto({}, opciones.titulo)}
      actual={opciones.actual}
      marca={puerta.marca.nombre}
      empresa={empresa.nombre}
      modulos={destinosDeModulos()}
    >
      {await contenido({ empresa, contexto })}
    </ArmazonDeOperacion>
  );
}
