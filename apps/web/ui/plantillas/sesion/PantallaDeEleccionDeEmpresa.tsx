import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Insignia } from "../../componentes/Insignia";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import { Texto } from "../../primitivas/Texto";
import { PlantillaNeutra } from "../PlantillaNeutra";
import estilos from "./PantallaDeEleccionDeEmpresa.module.css";
import { textoDeEstadoDeEmpresa, textoDelRol, type EmpresaParaMostrar } from "./textos-de-empresa";

export type PropsDePantallaDeEleccionDeEmpresa = Readonly<{
  empresas: readonly EmpresaParaMostrar[];
  /** La acción del servidor «Entrar a la empresa» (valida la empresa contra las de la persona en la marca). */
  accion: AccionDeFormulario;
  diccionario?: DiccionarioResuelto;
}>;

/** `/empresa`: la lista de empresas de la persona en esta marca. Cada una, con su botón. */
export function PantallaDeEleccionDeEmpresa({
  empresas,
  accion,
  diccionario = {},
}: PropsDePantallaDeEleccionDeEmpresa) {
  return (
    <PlantillaNeutra titulo={texto(diccionario, "empresa.elegir_titulo")}>
      <Texto>{texto(diccionario, "empresa.elegir_detalle")}</Texto>
      <ul className={estilos["lista"]}>
        {empresas.map((empresa) => {
          const noOpera = textoDeEstadoDeEmpresa(empresa.estadoEfectivo, diccionario);
          return (
            <li key={empresa.empresaId} className={estilos["empresa"]}>
              <FormularioDeAccion accion={accion} diccionario={diccionario}>
                <input type="hidden" name="empresaId" value={empresa.empresaId} />
                <Pila separacion={2}>
                  <p className={estilos["nombre"]}>{empresa.nombre}</p>
                  <Pila direccion="fila" separacion={2} envolver alinear="centro">
                    <Insignia tono="neutro">{textoDelRol(empresa.rol, diccionario)}</Insignia>
                    {noOpera === null ? null : <Insignia tono="aviso">{noOpera}</Insignia>}
                  </Pila>
                  <BotonDeEnvio
                    ancho="completo"
                    textoEnviando={texto(diccionario, "empresa.entrando")}
                  >
                    {texto(diccionario, "empresa.entrar")}
                  </BotonDeEnvio>
                </Pila>
              </FormularioDeAccion>
            </li>
          );
        })}
      </ul>
    </PlantillaNeutra>
  );
}
