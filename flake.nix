{
  description = "MedSearch — static site generator for Belgium's SAM v2 medication database";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # SAM v2 export — update these when a new version is published
        samVersion = "12314";
        samHash = "sha256-TdcTYVR51xs8sqi7rVqfuUp1QXJJuiBt8pY9XAvbcOg=";

        samExport = pkgs.fetchzip {
          url = "https://www.vas.ehealth.fgov.be/websamcivics/samcivics/download/samv2-download?type=FULL&xsd=5&version=${samVersion}";
          hash = samHash;
          stripRoot = false;
          extension = "zip";
        };

        # MiniSearch UMD bundle served as /minisearch.min.js.
        # Pinned via SRI hash: bump minisearchVersion + minisearchHash together.
        minisearchVersion = "7.2.0";
        minisearchJs = pkgs.fetchurl {
          url = "https://cdn.jsdelivr.net/npm/minisearch@${minisearchVersion}/dist/umd/index.min.js";
          hash = "sha256-igW0J4XbRI8sGeJKaiEHIEyCVWX+T5WqabeWUrryboI=";
        };

        # Only scripts — changes to generator/ or static/ won't trigger database rebuild
        databaseSrc = pkgs.lib.cleanSourceWith {
          src = ./.;
          filter = path: type:
            let base = builtins.baseNameOf path; in
            base == "scripts" || base == "package.json"
            || pkgs.lib.hasPrefix (toString ./scripts) path;
        };

        # Only generator + scripts — changes to static/ won't trigger html rebuild
        generatorSrc = pkgs.lib.cleanSourceWith {
          src = ./.;
          filter = path: type:
            let base = builtins.baseNameOf path; in
            base == "generator" || base == "scripts" || base == "package.json"
            || pkgs.lib.hasPrefix (toString ./generator) path
            || pkgs.lib.hasPrefix (toString ./scripts) path;
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [ bun curl unzip ];
          shellHook = ''
            echo "MedSearch build environment"
            echo ""
            echo "  nix build .#database   SAM XML → SQLite"
            echo "  nix build .#html       SQLite → HTML + search indexes"
            echo "  nix build .#site       Merge html + static assets"
            echo "  nix build              Full pipeline (= .#site)"
            echo "  nix develop            This shell"
            echo "  nix run .#update-sam   Check for new SAM version"
          '';
        };

        packages = {
          # Step 1: SAM XML → SQLite database
          database = pkgs.stdenv.mkDerivation {
            name = "medsearch-database";
            src = databaseSrc;
            nativeBuildInputs = [ pkgs.bun ];
            buildPhase = ''
              export HOME=$TMPDIR
              export DB_PATH=$TMPDIR/medsearch.sqlite
              mkdir -p data
              ln -s ${samExport} data/sam-export
              bun run scripts/sync-sam-database.ts --skip-download --verbose
            '';
            installPhase = "cp $TMPDIR/medsearch.sqlite $out";
          };

          # Step 2: SQLite → HTML pages + JSON search indexes (content only)
          html = pkgs.stdenv.mkDerivation {
            name = "medsearch-html";
            src = generatorSrc;
            nativeBuildInputs = [ pkgs.bun ];
            buildPhase = ''
              export HOME=$TMPDIR
              export DB_PATH=${self.packages.${system}.database}
              export SKIP_STATIC=1
              export SAM_VERSION="${samVersion}"
              mkdir -p static
              bun run generator/index.ts
            '';
            installPhase = "cp -r dist $out";
          };

          # Step 3: Merge html + static assets (cheap — only rebuilds on static/ changes)
          site = pkgs.runCommand "medsearch-site" {} ''
            mkdir -p $out
            cp -r ${self.packages.${system}.html}/* $out/
            chmod -R u+w $out
            cp -r ${./static}/. $out/
            # Overwrite the vendored minisearch.min.js with the SRI-pinned
            # Nix fetchurl build, so the deployed bundle is byte-for-byte
            # reproducible. `rm -f` first because cp -r from the nix store
            # leaves the destination read-only.
            rm -f $out/minisearch.min.js
            cp ${minisearchJs} $out/minisearch.min.js
          '';

          default = self.packages.${system}.site;
        };

        apps.update-sam = {
          type = "app";
          program = "${pkgs.writeShellApplication {
            name = "update-sam";
            runtimeInputs = [ pkgs.curl ];
            text = ''
              CURRENT="${samVersion}"
              LATEST=$(curl -sL "https://www.vas.ehealth.fgov.be/websamcivics/samcivics/download/samv2-full-getLastVersion?xsd=5" --max-time 15)

              if ! [[ "$LATEST" =~ ^[0-9]+$ ]]; then
                echo "ERROR: Could not determine latest version. Got: $LATEST"
                exit 1
              fi

              if [ "$CURRENT" = "$LATEST" ]; then
                echo "Already on latest SAM version: $CURRENT"
              else
                echo "New SAM version available!"
                echo "  Current: $CURRENT"
                echo "  Latest:  $LATEST"
                echo ""
                echo "Update samVersion in flake.nix to \"$LATEST\","
                echo "set samHash to \"\" and run nix build .#database to get the new hash."
              fi
            '';
          }}/bin/update-sam";
        };
      }
    );
}
