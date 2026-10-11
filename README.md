# DuoVerse

Jogo multiplayer para duas pessoas, feito com Node.js, Express e Socket.IO.

## Rodar no computador

Requer Node.js 20 ou superior.

```powershell
npm ci
npm start
```

Abra http://localhost:3000 no navegador. O servidor serve a página e mantém a conexão multiplayer. O Live Server pode mostrar a interface, mas criar e entrar em salas requer o servidor Node.js.

## Publicar no GitHub

1. Crie um repositório vazio no GitHub, sem adicionar README, licença ou `.gitignore`.
2. No terminal do VS Code, na pasta do projeto, execute os comandos abaixo. Troque a URL pela URL do repositório que você criou:

```powershell
git init
git add .
git commit -m "Prepare DuoVerse for deployment"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/duoverse.git
git push -u origin main
```

O arquivo `.gitignore` impede que `node_modules` e arquivos `.env` sejam enviados ao GitHub.

## Publicar no Render

1. Entre em https://render.com e conecte sua conta do GitHub.
2. No Render, escolha **New** > **Blueprint** e selecione o repositório do DuoVerse.
3. O Render vai usar `render.yaml` para instalar as dependências e iniciar o servidor.
4. Quando o deploy terminar, abra a URL `onrender.com` mostrada pelo Render.

O serviço do Render hospeda tanto a página quanto o Socket.IO, necessário para o multiplayer. No plano gratuito, o serviço pode levar um pouco para responder após um período sem acessos. As salas e o progresso ficam na memória do servidor e são reiniciados quando o servidor reinicia.

## Publicar a página na Vercel e manter o multiplayer

A Vercel serve a página estática; o servidor Socket.IO precisa continuar rodando no Render. O `vercel.json` configura `public/` como a pasta do site e evita o erro `Cannot GET /`.

1. Publique este repositório no Render usando o Blueprint acima e copie a URL do serviço, por exemplo `https://duoverse.onrender.com`.
2. Abra `public/config.js` e defina a URL do serviço, sem barra no final:

   ```js
   window.DUOVERSE_SERVER_URL = "https://duoverse.onrender.com";
   ```

3. Envie essa alteração ao GitHub.
4. Na Vercel, importe o mesmo repositório. Deixe o **Root Directory** como `./` e use o `vercel.json` detectado pelo projeto.
5. Depois do deploy, abra a URL `.vercel.app`.

Se o frontend e o servidor estiverem hospedados em serviços diferentes, configure no Render a variável de ambiente `CLIENT_URL` com a URL do site Vercel para permitir a conexão multiplayer. Se mudar o domínio Vercel, atualize essa variável.
