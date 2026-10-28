     FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
     WORKDIR /src
     COPY AzureEcho.Server.csproj .
     RUN dotnet restore
     COPY . .
     RUN dotnet publish -c Release -o /app

     FROM mcr.microsoft.com/dotnet/aspnet:10.0
     WORKDIR /app
     COPY --from=build /app .
     ENV DATA_DIR=/data
     ENTRYPOINT ["dotnet", "AzureEcho.Server.dll"]