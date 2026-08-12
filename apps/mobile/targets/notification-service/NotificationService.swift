import Foundation
import Intents
import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
    private let deliveryLock = NSLock()
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler

        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            finish(with: request.content)
            return
        }
        bestAttemptContent = content

        let userInfo = request.content.userInfo
        guard
            booleanValue(for: "communication", in: userInfo),
            let senderID = stringValue(for: "senderId", in: userInfo),
            let senderName = stringValue(for: "senderName", in: userInfo),
            let conversationID = stringValue(for: "channelId", in: userInfo)
        else {
            finish(with: content)
            return
        }

        let imageURL = stringValue(for: "senderImage", in: userInfo).flatMap(URL.init(string:))
        loadImage(from: imageURL) { [weak self] image in
            self?.deliverCommunicationNotification(
                content: content,
                senderID: senderID,
                senderName: senderName,
                senderImage: image,
                conversationName: self?.stringValue(
                    for: "conversationName",
                    in: userInfo
                ),
                conversationID: conversationID
            )
        }
    }

    override func serviceExtensionTimeWillExpire() {
        if let bestAttemptContent {
            finish(with: bestAttemptContent)
        }
    }

    private func deliverCommunicationNotification(
        content: UNMutableNotificationContent,
        senderID: String,
        senderName: String,
        senderImage: INImage?,
        conversationName: String?,
        conversationID: String
    ) {
        var nameComponents = PersonNameComponents()
        nameComponents.nickname = senderName

        let sender = INPerson(
            personHandle: INPersonHandle(value: senderID, type: .unknown),
            nameComponents: nameComponents,
            displayName: senderName,
            image: senderImage,
            contactIdentifier: nil,
            customIdentifier: senderID,
            isMe: false,
            suggestionType: .none
        )
        let speakableGroupName = conversationName.map {
            INSpeakableString(spokenPhrase: $0)
        }
        let intent = INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: content.body,
            speakableGroupName: speakableGroupName,
            conversationIdentifier: conversationID,
            serviceName: nil,
            sender: sender,
            attachments: nil
        )
        if let senderImage {
            intent.setImage(senderImage, forParameterNamed: \.sender)
        }

        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        interaction.donate { [weak self] _ in
            do {
                self?.finish(with: try content.updating(from: intent))
            } catch {
                self?.finish(with: content)
            }
        }
    }

    private func loadImage(from url: URL?, completion: @escaping (INImage?) -> Void) {
        guard let url else {
            completion(nil)
            return
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 5
        URLSession.shared.dataTask(with: request) { data, response, _ in
            guard
                let httpResponse = response as? HTTPURLResponse,
                (200..<300).contains(httpResponse.statusCode),
                let data,
                !data.isEmpty
            else {
                completion(nil)
                return
            }
            completion(INImage(imageData: data))
        }.resume()
    }

    private func stringValue(
        for key: String,
        in userInfo: [AnyHashable: Any]
    ) -> String? {
        if let value = userInfo[key] as? String, !value.isEmpty {
            return value
        }
        if
            let data = userInfo["data"] as? [String: Any],
            let value = data[key] as? String,
            !value.isEmpty
        {
            return value
        }
        return nil
    }

    private func booleanValue(
        for key: String,
        in userInfo: [AnyHashable: Any]
    ) -> Bool {
        if let value = userInfo[key] as? Bool {
            return value
        }
        if
            let data = userInfo["data"] as? [String: Any],
            let value = data[key] as? Bool
        {
            return value
        }
        return false
    }

    private func finish(with content: UNNotificationContent) {
        deliveryLock.lock()
        let handler = contentHandler
        contentHandler = nil
        deliveryLock.unlock()
        handler?(content)
    }
}
