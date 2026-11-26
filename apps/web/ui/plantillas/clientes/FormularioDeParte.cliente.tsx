"use client";

import { useActionState, useEffect, useState } from "react";
import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import type { TipoDeDocumentoDeIdentidad } from "../../../../../src/primitivas/identificacion-fiscal/documento";
import { AreaDeTexto } from "../../componentes/AreaDeTexto";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { CampoDeDocumento } from "../../componentes/CampoDeDocumento";
import { Casilla } from "../../componentes/Casilla";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import { FormularioDeEstadoDeParte } from "./FormularioDeEstadoDeParte.cliente";
import estilos from "./PantallasDelDirectorio.module.css";
import { RUTA_DE_CLIENTES } from "./modelo-de-directorio";
import type { FormularioDeParteArmado } from "./modelo-de-formulario-de-parte";
import { sinReiniciar } from "../../patrones/sin-reinicio";

/** Lo que vuelve de guardar (la misma forma que `ResultadoDeGuardarLaParte` de `servidor/directorio.ts`): el error ya traducido, si quedó guardada y las partes parecidas. */
export type ResultadoDelFormularioDeParte = Readonly<{
  error: ErrorPublico | null;
  guardada: boolean;
  duplicados: readonly Readonly<{ parteId: string; nombre: string }>[];
}>;

export type PropsDeFormularioDeParte = Readonly<{
  formulario: FormularioDeParteArmado;
  /** La acción de servidor (`crearParteAccion` ligada a la clave de creación, o `editarParteAccion` ligada a la parte y su versión). */
  accion: (
    previo: ResultadoDelFormularioDeParte,
    datos: FormData,
  ) => Promise<ResultadoDelFormularioDeParte>;
  /** «Desactivar» o «Reactivar» ligada a la parte (solo al editar); `null` en el alta. */
  accionDeEstado: AccionDeFormulario | null;
}>;

/** Los campos a los que un error puede apuntarse (los que muestran su propio error). */
const CAMPOS = ["nombre", "documentoNumero", "email", "telefono"];

const INICIAL: ResultadoDelFormularioDeParte = { error: null, guardada: false, duplicados: [] };

const esTipoConFormato = (tipo: string): tipo is TipoDeDocumentoDeIdentidad =>
  ["CUIT", "CUIL", "CDI", "DNI", "PASAPORTE"].includes(tipo);

/**
 * Alta y edición de una persona o empresa (maqueta `directorio.html`, «Nuevo» y la ficha: el mismo formulario). La validez la decide el servidor: acá no se valida CUIT, DNI, email ni
 * teléfono, y «Guardar» se ofrece siempre que haya permiso (el nombre vacío lo rechaza el servidor). Un error que apunta a un campo se asocia a ese campo (`aria-describedby`); el resto
 * sale debajo con el patrón común, de a uno. Repetir el envío no duplica: la clave de creación (o la versión) va ligada a la acción por la página y el botón ignora el segundo toque.
 * Si hay posibles duplicados, NO se escribió nada: se muestran y el botón pasa a «Guardar igual», que reenvía con la misma clave. La acción no redirige (un `redirect` dentro de una
 * acción pierde el host): cuando quedó guardada, la pantalla vuelve a la lista. Lo que una naturaleza no lleva (apellido en la empresa, país sin pasaporte) no se muestra y por eso no se manda.
 */
export function FormularioDeParte({
  formulario,
  accion,
  accionDeEstado,
}: PropsDeFormularioDeParte) {
  const [resultado, enviar, enviando] = useActionState(accion, INICIAL);
  const [naturaleza, setNaturaleza] = useState<string>(formulario.naturaleza.valorInicial);
  const [nombre, setNombre] = useState(formulario.nombre.valorInicial);
  const [apellido, setApellido] = useState(formulario.apellido.valorInicial);
  const [alias, setAlias] = useState(formulario.alias.valorInicial);
  const [tipo, setTipo] = useState(formulario.documentoTipo.valorInicial);
  const [numero, setNumero] = useState(formulario.documentoNumero.valorInicial);
  const [pais, setPais] = useState(formulario.documentoPais.valorInicial);
  const [condicion, setCondicion] = useState(formulario.condicionIva.valorInicial);
  const [email, setEmail] = useState(formulario.email.valorInicial);
  const [telefono, setTelefono] = useState(formulario.telefono.valorInicial);
  const [calle, setCalle] = useState(formulario.calle.valorInicial);
  const [numeroDeCalle, setNumeroDeCalle] = useState(formulario.numero.valorInicial);
  const [codigoPostal, setCodigoPostal] = useState(formulario.codigoPostal.valorInicial);
  const [localidad, setLocalidad] = useState(formulario.localidad.valorInicial);
  const [provincia, setProvincia] = useState(formulario.provincia.valorInicial);
  const [esCliente, setEsCliente] = useState(formulario.roles.cliente.valorInicial);
  const [esProveedor, setEsProveedor] = useState(formulario.roles.proveedor.valorInicial);
  const [nota, setNota] = useState(formulario.nota.valorInicial);

  useEffect(() => {
    if (resultado.guardada) window.location.assign(RUTA_DE_CLIENTES);
  }, [resultado.guardada]);

  const esPersona = naturaleza === "HUMANA";
  const opcionesDeTipo = formulario.documentoTipo.opciones[esPersona ? "HUMANA" : "JURIDICA"];
  const hayDuplicados = resultado.duplicados.length > 0;

  const cambiarNaturaleza = (nueva: string) => {
    setNaturaleza(nueva);
    // Una empresa solo lleva CUIT: si el tipo elegido ya no se ofrece, vuelve al primero de la lista nueva (y no se manda un tipo que el servidor rechaza).
    const ofrecidas = formulario.documentoTipo.opciones[nueva === "HUMANA" ? "HUMANA" : "JURIDICA"];
    if (!ofrecidas.some((o) => o.valor === tipo)) setTipo(ofrecidas[0]?.valor ?? "");
  };

  const error = resultado.error;
  const campoDelError = error?.campo;
  const textoDeError = error === null ? undefined : texto({}, error.clave);
  const errorDe = (campo: string): string | undefined =>
    campoDelError === campo ? textoDeError : undefined;
  const errorSinCampo = error !== null && !CAMPOS.includes(campoDelError ?? "") ? error : null;

  // Con duplicados a la vista, el envío lleva «guardarIgual»: la clave de creación es la misma, así que no se duplica nada.
  const alEnviar = (datos: FormData) => {
    if (hayDuplicados) datos.set("guardarIgual", "1");
    enviar(datos);
  };

  return (
    <div className={estilos["raiz"]}>
      <a
        className={estilos["volver"]}
        href={formulario.volver.href}
        aria-label={formulario.volver.etiqueta}
      >
        <span aria-hidden="true">‹</span>
      </a>
      <form action={alEnviar} onReset={sinReiniciar}>
        <ProveedorDeEnvioDeFormulario value={enviando}>
          <Pila separacion={3}>
            <Selector
              dato="naturaleza-de-parte"
              etiqueta={formulario.naturaleza.etiqueta}
              nombre="naturaleza"
              valor={naturaleza}
              alCambiar={cambiarNaturaleza}
              opciones={formulario.naturaleza.opciones}
            />
            <Campo
              dato="nombre-de-parte"
              etiqueta={
                esPersona
                  ? formulario.nombre.etiquetaDePersona
                  : formulario.nombre.etiquetaDeEmpresa
              }
              nombre="nombre"
              valor={nombre}
              alCambiar={setNombre}
              autoComplete="off"
              error={errorDe("nombre")}
            />
            {esPersona ? (
              <Campo
                dato="apellido-de-parte"
                etiqueta={formulario.apellido.etiqueta}
                nombre="apellido"
                valor={apellido}
                alCambiar={setApellido}
                autoComplete="off"
              />
            ) : null}
            <Campo
              dato="alias-de-parte"
              etiqueta={formulario.alias.etiqueta}
              nombre="alias"
              valor={alias}
              alCambiar={setAlias}
              autoComplete="off"
            />
            <Selector
              dato="tipo-de-documento-de-parte"
              etiqueta={formulario.documentoTipo.etiqueta}
              nombre="documentoTipo"
              valor={tipo}
              alCambiar={setTipo}
              opciones={opcionesDeTipo}
              textoDeElegir={
                formulario.documentoTipo.conOpcionVacia ? formulario.textos.sinElegir : undefined
              }
            />
            <CampoDeDocumento
              dato="documento-de-parte"
              etiqueta={formulario.documentoNumero.etiqueta}
              nombre="documentoNumero"
              tipo={esTipoConFormato(tipo) ? tipo : "CUIT"}
              valor={numero}
              alCambiar={setNumero}
              error={errorDe("documentoNumero")}
            />
            {tipo === "PASAPORTE" ? (
              <Campo
                dato="pais-de-documento-de-parte"
                etiqueta={formulario.documentoPais.etiqueta}
                nombre="documentoPais"
                valor={pais}
                alCambiar={setPais}
                autoComplete="off"
              />
            ) : null}
            <Selector
              dato="condicion-iva-de-parte"
              etiqueta={formulario.condicionIva.etiqueta}
              nombre="condicionIva"
              valor={condicion}
              alCambiar={setCondicion}
              opciones={formulario.condicionIva.opciones}
              textoDeElegir={formulario.textos.sinElegir}
            />
            <Campo
              dato="correo-de-parte"
              etiqueta={formulario.email.etiqueta}
              nombre="email"
              tipo="email"
              valor={email}
              alCambiar={setEmail}
              autoComplete="off"
              error={errorDe("email")}
            />
            <Campo
              dato="telefono-de-parte"
              etiqueta={formulario.telefono.etiqueta}
              nombre="telefono"
              tipo="tel"
              valor={telefono}
              alCambiar={setTelefono}
              autoComplete="off"
              error={errorDe("telefono")}
            />
            <h3 className={estilos["seccion"]}>{formulario.domicilio}</h3>
            <Campo
              dato="calle-de-parte"
              etiqueta={formulario.calle.etiqueta}
              nombre="calle"
              valor={calle}
              alCambiar={setCalle}
              autoComplete="off"
            />
            <Campo
              dato="numero-de-calle-de-parte"
              etiqueta={formulario.numero.etiqueta}
              nombre="numero"
              valor={numeroDeCalle}
              alCambiar={setNumeroDeCalle}
              inputMode="numeric"
              autoComplete="off"
            />
            <Campo
              dato="codigo-postal-de-parte"
              etiqueta={formulario.codigoPostal.etiqueta}
              nombre="codigoPostal"
              valor={codigoPostal}
              alCambiar={setCodigoPostal}
              autoComplete="off"
            />
            <Campo
              dato="localidad-de-parte"
              etiqueta={formulario.localidad.etiqueta}
              nombre="localidad"
              valor={localidad}
              alCambiar={setLocalidad}
              autoComplete="off"
            />
            <Selector
              dato="provincia-de-parte"
              etiqueta={formulario.provincia.etiqueta}
              nombre="provincia"
              valor={provincia}
              alCambiar={setProvincia}
              opciones={formulario.provincia.opciones}
              textoDeElegir={formulario.textos.sinElegir}
            />
            <h3 className={estilos["seccion"]}>{formulario.roles.titulo}</h3>
            <Casilla
              dato="roles-de-parte"
              etiqueta={formulario.roles.cliente.etiqueta}
              nombre="rolCliente"
              marcada={esCliente}
              alCambiar={setEsCliente}
            />
            <Casilla
              dato="roles-de-parte"
              etiqueta={formulario.roles.proveedor.etiqueta}
              nombre="rolProveedor"
              marcada={esProveedor}
              alCambiar={setEsProveedor}
            />
            <AreaDeTexto
              dato="nota-de-parte"
              etiqueta={formulario.nota.etiqueta}
              nombre="nota"
              valor={nota}
              alCambiar={setNota}
            />
            {hayDuplicados ? (
              <Aviso tono="aviso" titulo={formulario.textos.posiblesDuplicados}>
                <div className={estilos["duplicados"]}>
                  {resultado.duplicados.map((d) => (
                    <span key={d.parteId}>{d.nombre}</span>
                  ))}
                </div>
              </Aviso>
            ) : null}
            {errorSinCampo === null ? null : <ErrorDeRespuesta error={errorSinCampo} />}
            {formulario.puedeGuardar ? (
              <BotonDeEnvio>
                {hayDuplicados ? formulario.textos.guardarIgual : formulario.guardar}
              </BotonDeEnvio>
            ) : (
              <Boton deshabilitado>{formulario.guardar}</Boton>
            )}
          </Pila>
        </ProveedorDeEnvioDeFormulario>
      </form>
      {accionDeEstado === null || formulario.estado === null ? null : (
        <FormularioDeEstadoDeParte
          texto={formulario.estado.texto}
          apagado={formulario.estado.apagado}
          accion={accionDeEstado}
        />
      )}
    </div>
  );
}
