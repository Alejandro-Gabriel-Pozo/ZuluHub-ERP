"use client";

import { useActionState, useEffect, useState } from "react";
import { Aviso } from "../../componentes/Aviso";
import { Campo } from "../../componentes/Campo";
import { Casilla } from "../../componentes/Casilla";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Selector } from "../../componentes/Selector";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import { ProveedorDeEnvioDeFormulario } from "../../patrones/EnvioDeFormulario.cliente";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { Pila } from "../../primitivas/Pila";
import {
  ROL_CON_SUCURSALES,
  ROL_INICIAL_DE_LA_INVITACION,
  type FormularioDeInvitacionArmado,
  type RolInvitable,
} from "./modelo-de-invitaciones";
import { INVITAR_INICIAL, type ResultadoDeInvitar } from "./resultado-de-usuarios";
import estilos from "./PantallaDeUsuarios.module.css";

export type PropsDeFormularioDeInvitacion = Readonly<{
  formulario: FormularioDeInvitacionArmado;
  /** `invitarUsuarioAccion` (acción de servidor): el servidor decide el permiso y la validez de cada dato. */
  accion: (previo: ResultadoDeInvitar, datos: FormData) => Promise<ResultadoDeInvitar>;
  /** Adónde se va al terminar y con «Cancelar»: la lista. */
  rutaDeLaLista: string;
}>;

/**
 * Invitar por mail (maqueta `usuarios.html`, `vInvitar`): Email, Rol y, solo si el rol es Empleado, las sucursales activas. «Enviar invitación» y «Cancelar».
 *  - Sin validación del email acá: la decide el servidor (la primitiva del email) y vuelve como error.
 *  - Doble toque: el botón se apaga mientras envía (`BotonDeEnvio`); lo que evita el duplicado de verdad es el servidor (una invitación vigente por email y empresa): el segundo envío devuelve la misma
 *    y el aviso «Ya había una invitación pendiente para ese email», no un error y sin otro mail.
 *  - Hecho: vuelve a la lista con `window.location.assign`, donde la invitación ya figura (esa es la confirmación; la acción no redirige).
 *  - Las sucursales solo viajan con el rol Empleado: al cambiar a Administrador no se mandan (el servidor además las descarta).
 * El estado del formulario es de la pantalla; los permisos no se replican (la lista solo ofrece «Invitar» a quien puede, y el servidor lo vuelve a exigir).
 */
export function FormularioDeInvitacion({
  formulario,
  accion,
  rutaDeLaLista,
}: PropsDeFormularioDeInvitacion) {
  const [resultado, enviar, enviando] = useActionState(accion, INVITAR_INICIAL);
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<RolInvitable>(ROL_INICIAL_DE_LA_INVITACION);
  const [elegidas, setElegidas] = useState<readonly string[]>([]);
  const hecho = resultado.estado === "HECHO";

  useEffect(() => {
    if (hecho) window.location.assign(rutaDeLaLista);
  }, [hecho, rutaDeLaLista]);

  return (
    <form action={enviar} noValidate>
      <ProveedorDeEnvioDeFormulario value={enviando}>
        <Pila separacion={4}>
          {resultado.estado === "YA_HABIA" ? (
            <Aviso tono="info">{formulario.textos.yaHabia}</Aviso>
          ) : null}
          {resultado.estado === "ERROR" ? <ErrorDeRespuesta error={resultado.error} /> : null}
          <Campo
            dato="email-de-invitacion"
            etiqueta={formulario.textos.email}
            nombre="email"
            tipo="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="off"
            valor={email}
            alCambiar={setEmail}
          />
          <Selector
            dato="rol-de-invitacion"
            etiqueta={formulario.textos.rol}
            nombre="rol"
            valor={rol}
            alCambiar={(valor) => {
              const elegido = formulario.roles.find((r) => r.valor === valor);
              if (elegido !== undefined) setRol(elegido.valor);
            }}
            opciones={formulario.roles.map((r) => ({ valor: r.valor, etiqueta: r.etiqueta }))}
          />
          {rol === ROL_CON_SUCURSALES ? (
            <fieldset className={estilos["grupo"]}>
              <legend>{formulario.textos.sucursales}</legend>
              {formulario.sucursales.map((s) => (
                <Casilla
                  key={s.id}
                  dato="sucursales-de-usuario"
                  etiqueta={s.nombre}
                  nombre="sucursales"
                  valor={s.id}
                  marcada={elegidas.includes(s.id)}
                  alCambiar={(marcada) => {
                    setElegidas((previas) =>
                      marcada ? [...previas, s.id] : previas.filter((id) => id !== s.id),
                    );
                  }}
                />
              ))}
            </fieldset>
          ) : null}
          <div className={estilos["botones"]}>
            <BotonDeEnvio>{formulario.textos.enviar}</BotonDeEnvio>
            <EnlaceDeAccion href={rutaDeLaLista} variante="secundaria">
              {formulario.textos.cancelar}
            </EnlaceDeAccion>
          </div>
        </Pila>
      </ProveedorDeEnvioDeFormulario>
    </form>
  );
}
