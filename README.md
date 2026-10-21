# Comerix CLI

Work on a Comerix store's theme from a folder on your computer — with your own editor, git and AI agents — and send it
to the store with one command. Nothing goes live until the merchant presses **Publish** in the Comerix Builder.

## Install

Node.js 20 or newer. No other dependencies.

```sh
npm install -g https://www.comerix.in/developers/cli/comerix-cli.tgz
comerix --help
```

## Use

```sh
comerix login                      # token: Comerix Builder → AI → Create token ("Read and edit")
comerix theme init my-theme --from https://github.com/gocomerix/maison.git
cd my-theme
comerix theme list                 # the store's themes and ids
comerix theme push --theme <id>    # upload changed files (the folder remembers the id)
comerix theme dev                  # push every save while you work
comerix theme check                # Theme Check on the theme in the store
comerix theme preview              # a link to see the unpublished theme
```

`COMERIX_TOKEN` in the environment is used instead of the saved token (CI, AI agents).

Base themes: [Maison](https://github.com/gocomerix/maison) · [Starter](https://github.com/gocomerix/starter)

Docs: https://www.comerix.in/developers/themes/cli

## Develop

```sh
npm test
```
